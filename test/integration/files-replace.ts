// M06-C evidence (PR #8 review): a failed, aborted or over-limit
// replacement upload must leave the previous firmware version
// downloadable with the same bytes — the old route deleted the stored
// version BEFORE the replacement stream completed. The successful path
// swaps content and metadata under the same public id.
import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { startApp } from "../helpers/app.ts";
import { collections } from "../../lib/db/db.ts";
import {
  FILE_MAX_BYTES,
  FileTooLargeError,
  replaceFile,
} from "../../lib/ui/db.ts";

const FILE_ID = "fw-replace-test.bin";

void test("file replacement: abort/limit failures keep the old version", async (t) => {
  const app = await startApp();
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

    await t.test("aborted replacement keeps the old version", async () => {
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
      // No temp records survive the failed attempt.
      assert.equal(
        await collections.files.countDocuments({
          _id: new RegExp("__replace__"),
        }),
        0,
      );
    });

    await t.test(
      "over-limit stream is refused, old version intact",
      async () => {
        // 8 MiB chunks cross the cap on the 13th push — fast, and no
        // Content-Length is involved (the cap counts streamed bytes).
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
        assert.equal(
          await collections.files.countDocuments({
            _id: new RegExp("__replace__"),
          }),
          0,
        );
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
  } finally {
    const { deleteFile } = await import("../../lib/ui/db.ts");
    await deleteFile(FILE_ID).catch(() => undefined);
    await app.stop();
  }
});
