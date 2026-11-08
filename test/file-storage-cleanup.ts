import test from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable, PassThrough } from "node:stream";
import type { GridFSBucketWriteStream } from "mongodb";
import { connect, disconnect, fileContentsBucket } from "../lib/db/db.ts";
import { replaceStoredFile, FileTooLargeError } from "../lib/file-storage.ts";

void test(
  "failed uploads await pending chunk writes before deleting content",
  { skip: !process.env.MONGO_URL },
  async (t) => {
    await connect();
    let active = 0;
    let activeAtCleanup: number | null = null;
    const sizes: number[] = [];
    let started!: () => void;
    let settled!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const writeSettled = new Promise<void>((resolve) => {
      settled = resolve;
    });
    // Like GridFS, destroying this stream does not await its pending storage
    // operation. setImmediate injects a delayed insert without wall-clock sleeps.
    const upload = Object.assign(
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          sizes.push(chunk.length);
          active++;
          started();
          setImmediate(() => {
            active--;
            callback();
            settled();
          });
        },
      }),
      { chunkSizeBytes: 4 },
    );
    const open = t.mock.method(
      fileContentsBucket,
      "openUploadStreamWithId",
      () => upload as unknown as GridFSBucketWriteStream,
    );
    const remove = t.mock.method(fileContentsBucket, "delete", async () => {
      activeAtCleanup = active;
    });
    try {
      const input = Readable.from(
        (async function* () {
          yield Buffer.alloc(8);
          await writeStarted;
          yield Buffer.alloc(1);
        })(),
      );
      await assert.rejects(
        replaceStoredFile("cleanup-fixture", {}, input, 8),
        FileTooLargeError,
      );
      assert.equal(
        activeAtCleanup,
        0,
        "cleanup must happen after every insert callback",
      );
      assert.deepEqual(sizes, [4, 4], "one insert at most per awaited write");
      assert.equal(remove.mock.calls.length, 1);
    } finally {
      await writeSettled;
      open.mock.restore();
      remove.mock.restore();
      await disconnect();
    }
  },
);

void test(
  "upload initialization failure interrupts a source waiting for data",
  { skip: !process.env.MONGO_URL },
  async (t) => {
    await connect();
    const input = new PassThrough();
    const upload = Object.assign(
      new Writable({
        construct(callback) {
          callback(new Error("FIXTURE_INDEX_FAILED"));
        },
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
      { chunkSizeBytes: 4 },
    );
    const open = t.mock.method(
      fileContentsBucket,
      "openUploadStreamWithId",
      () => upload as unknown as GridFSBucketWriteStream,
    );
    const remove = t.mock.method(
      fileContentsBucket,
      "delete",
      async () => undefined,
    );
    const result = replaceStoredFile("cleanup-fixture", {}, input, 8);
    let deadline!: ReturnType<typeof setImmediate>;
    try {
      await assert.rejects(
        Promise.race([
          result,
          new Promise<never>((_resolve, reject) => {
            deadline = setImmediate(() =>
              reject(new Error("source wait was not interrupted")),
            );
          }),
        ]),
        /FIXTURE_INDEX_FAILED/,
      );
      assert.equal(remove.mock.calls.length, 1);
    } finally {
      clearImmediate(deadline);
      input.destroy();
      await result.catch(() => undefined);
      open.mock.restore();
      remove.mock.restore();
      await disconnect();
    }
  },
);
