// M06-C evidence (PR #8 review): a failed, aborted or over-limit
// replacement upload must leave the previous firmware version
// downloadable with the same bytes — the old route deleted the stored
// version BEFORE the replacement stream completed. The successful path
// swaps content and metadata under the same public id.
import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { startApp } from "../helpers/app.ts";
import {
  collections,
  filesBucket,
  fileContentsBucket,
  connect,
  disconnect,
} from "../../lib/db/db.ts";
import * as engineServer from "../../lib/server.ts";
import { ObjectId, MongoClient } from "mongodb";
import { listener as fsListener } from "../../lib/fs.ts";
import { listener as nbiListener } from "../../lib/nbi.ts";
import {
  FILE_MAX_BYTES,
  FileTooLargeError,
  replaceFile,
} from "../../lib/ui/db.ts";

const FILE_ID = "fw-replace-test.bin";

void test("file replacement: abort/limit failures keep the old version", async (t) => {
  const app = await startApp();
  const contentClient = await MongoClient.connect(process.env.MONGO_URL!);
  const contentDb = contentClient.db();
  const privateCounts = async (): Promise<[number, number]> =>
    Promise.all([
      contentDb.collection("file_contents.files").countDocuments({}),
      contentDb.collection("file_contents.chunks").countDocuments({}),
    ]);
  try {
    const put = await app.appRequest(
      `/api/files/${FILE_ID}`,
      {
        method: "PUT",
        body: "old-bytes",
        headers: {
          // The helper defaults to application/json for bodies — the
          // file upload is an octet-stream (a JSON content-type makes
          // the body parser reject the raw bytes with 400).
          "Content-Type": "application/octet-stream",
          "metadata-filetype": "1 Firmware Upgrade Image",
        },
      },
      "admin",
    );
    assert.equal(put.status, 200);

    const checksumOf = async (): Promise<string> => {
      const dl = await app.appRequest(
        `/api/blob/files/${FILE_ID}`,
        {},
        "admin",
      );
      assert.equal(dl.status, 200);
      return createHash("sha1")
        .update(Buffer.from(await dl.arrayBuffer()))
        .digest("hex");
    };
    const before = await checksumOf();
    assert.equal(await checksumOf(), before);

    await t.test(
      "publication failure preserves the published firmware",
      async () => {
        const fail = async (): Promise<never> => {
          throw new Error("injected publication failure");
        };
        const oldSwap = t.mock.method(collections.fsChunks, "updateMany", fail);
        const pointerSwap = t.mock.method(
          collections.files,
          "findOneAndReplace",
          fail,
        );
        try {
          await assert.rejects(
            () =>
              replaceFile(
                FILE_ID,
                {},
                Readable.from(["unpublished replacement"]),
              ),
            /injected publication failure/,
          );
        } finally {
          oldSwap.mock.restore();
          pointerSwap.mock.restore();
        }
        assert.equal(await checksumOf(), before);
      },
    );

    await t.test("aborted replacement keeps the old version", async () => {
      const countsBefore = await privateCounts();
      const broken = new Readable({
        read() {
          this.push("partial-new-");
          this.destroy(new Error("client aborted mid-upload"));
        },
      });
      await assert.rejects(() =>
        replaceFile(FILE_ID, { fileType: "1 Firmware Upgrade Image" }, broken),
      );
      assert.equal(await checksumOf(), before);
      assert.deepEqual(await privateCounts(), countsBefore);
    });

    await t.test(
      "over-limit stream is refused, old version intact",
      async () => {
        // 8 MiB chunks cross the cap on the 13th push — fast, and no
        // Content-Length is involved (the cap counts streamed bytes).
        const countsBefore = await privateCounts();
        const chunk = Buffer.alloc(8 * 1024 * 1024, 1);
        let sent = 0;
        const huge = new Readable({
          read() {
            if (sent <= FILE_MAX_BYTES + chunk.length) {
              sent += chunk.length;
              this.push(chunk);
            } else this.push(null);
          },
        });
        await assert.rejects(
          () => replaceFile(FILE_ID, {}, huge),
          (err: unknown) => err instanceof FileTooLargeError,
        );
        assert.equal(await checksumOf(), before);
        assert.deepEqual(await privateCounts(), countsBefore);
      },
    );

    await t.test(
      "successful replacement swaps content and metadata",
      async () => {
        const next = new Readable({
          read() {
            this.push("new-bytes-1234");
            this.push(null);
          },
        });
        await replaceFile(
          FILE_ID,
          { fileType: "1 Firmware Upgrade Image", version: "2.0" },
          next,
        );
        const dl = await app.appRequest(
          `/api/blob/files/${FILE_ID}`,
          {},
          "admin",
        );
        assert.equal(await dl.text(), "new-bytes-1234");
        const row = (await collections.files.findOne({
          _id: FILE_ID,
        })) as unknown as { metadata?: Record<string, string> };
        assert.equal(row.metadata?.fileType, "1 Firmware Upgrade Image");
        assert.equal(row.metadata?.version, "2.0");
        // Exactly one published record under the public id.
        assert.equal(
          await collections.files.countDocuments({ _id: FILE_ID }),
          1,
        );
      },
    );

    await t.test(
      "range requests serve partial content through the real endpoint",
      async () => {
        const partial = await app.appRequest(
          `/api/blob/files/${FILE_ID}`,
          { headers: { Range: "bytes=4-8" } },
          "admin",
        );
        assert.equal(partial.status, 206);
        // "new-bytes-1234" is 14 bytes; slice 4..8 spells "bytes".
        assert.equal(partial.headers.get("content-range"), "bytes 4-8/14");
        assert.equal(await partial.text(), "bytes");
        // Suffix range serves the tail.
        const suffix = await app.appRequest(
          `/api/blob/files/${FILE_ID}`,
          { headers: { Range: "bytes=-4" } },
          "admin",
        );
        assert.equal(suffix.status, 206);
        assert.equal(await suffix.text(), "1234");
        // Unsatisfiable range answers 416.
        const invalid = await app.appRequest(
          `/api/blob/files/${FILE_ID}`,
          { headers: { Range: "bytes=999-1000" } },
          "admin",
        );
        assert.equal(invalid.status, 416);
      },
    );

    await t.test(
      "concurrent replacements publish one complete version",
      async () => {
        const versions = ["a", "b", "c"].map((letter) =>
          Buffer.alloc(600_000, letter),
        );
        await Promise.all(
          versions.map((data, index) =>
            replaceFile(
              FILE_ID,
              { version: String(index) },
              Readable.from([data]),
            ),
          ),
        );
        const downloaded = await app.appRequest(
          `/api/blob/files/${FILE_ID}`,
          {},
          "admin",
        );
        assert.equal(downloaded.status, 200);
        const bytes = Buffer.from(await downloaded.arrayBuffer());
        const current = await collections.files.findOne({ _id: FILE_ID });
        assert.ok(current);
        assert.deepEqual(bytes, versions[Number(current.metadata?.version)]);
        assert.equal(
          await collections.files.countDocuments({ _id: FILE_ID }),
          1,
        );
      },
    );

    await t.test(
      "lost publication response retains the committed content",
      async () => {
        const publish = collections.files.findOneAndReplace.bind(
          collections.files,
        );
        const mock = t.mock.method(
          collections.files,
          "findOneAndReplace",
          async (...args: Parameters<typeof publish>) => {
            await publish(...args);
            throw new Error("lost publication response");
          },
        );
        try {
          await assert.rejects(
            () =>
              replaceFile(
                FILE_ID,
                {},
                Readable.from(["committed despite lost response"]),
              ),
            /lost publication response/,
          );
        } finally {
          mock.mock.restore();
        }
        const downloaded = await app.appRequest(
          `/api/blob/files/${FILE_ID}`,
          {},
          "admin",
        );
        assert.equal(downloaded.status, 200);
        assert.equal(
          await downloaded.text(),
          "committed despite lost response",
        );
      },
    );
  } finally {
    const { deleteFile } = await import("../../lib/ui/db.ts");
    await deleteFile(FILE_ID).catch(() => undefined);
    // Completed publication failures deliberately retain recovery bytes.
    // Remove only this fixture's private versions at the end of the test.
    for await (const file of fileContentsBucket.find({ filename: FILE_ID }))
      await fileContentsBucket.delete(file._id).catch(() => undefined);
    await contentClient.close();
    await app.stop();
  }
});

void test("native FS and NBI retain legacy and new string file IDs", async () => {
  await connect();
  const legacyId = `${FILE_ID}-legacy`;
  const base = "http://127.0.0.1:8959";
  engineServer.start(
    { port: 8959, host: "127.0.0.1", ssl: null, timeout: 15000 },
    async (req, res) => {
      if (req.url.startsWith("/nbi/")) {
        req.url = req.url.slice(4);
        return nbiListener(req, res);
      }
      return fsListener(req, res);
    },
  );
  try {
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        if (
          (
            await fetch(`${base}/__probe__`, {
              signal: AbortSignal.timeout(1000),
            })
          ).status === 404
        )
          break;
      } catch {
        /* listener starting */
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await collections.files.deleteOne({ _id: legacyId });
    await collections.fsChunks.deleteMany({ files_id: legacyId });
    await pipeline(
      Readable.from(["legacy-content"]),
      filesBucket.openUploadStreamWithId(
        legacyId as unknown as ObjectId,
        legacyId,
      ),
    );
    const legacy = await fetch(`${base}/${legacyId}`);
    assert.equal(legacy.status, 200);
    assert.equal(await legacy.text(), "legacy-content");
    await replaceFile(legacyId, {}, Readable.from(["ui-replacement"]));
    const current = await fetch(`${base}/${legacyId}`);
    assert.equal(current.status, 200);
    assert.equal(await current.text(), "ui-replacement");
    const uploaded = await fetch(`${base}/nbi/files/${legacyId}`, {
      method: "PUT",
      body: "nbi-replacement",
    });
    assert.equal(uploaded.status, 201);
    const replaced = await fetch(`${base}/${legacyId}`, {
      headers: { Range: "bytes=0-2" },
    });
    assert.equal(replaced.status, 206);
    assert.equal(await replaced.text(), "nbi");
    const removed = await fetch(`${base}/nbi/files/${legacyId}`, {
      method: "DELETE",
    });
    assert.equal(removed.status, 200);
    assert.equal((await fetch(`${base}/${legacyId}`)).status, 404);
  } finally {
    await collections.files.deleteOne({ _id: legacyId });
    await collections.fsChunks.deleteMany({ files_id: legacyId });
    await engineServer.stop();
    await disconnect();
  }
});
