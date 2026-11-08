// Public fs.files IDs remain native string filenames. New content is immutable
// in a separate bucket, so publishing a complete version is one atomic document
// replacement, including on standalone MongoDB (no GridFS transaction needed).
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { ObjectId, type GridFSBucketReadStreamOptions } from "mongodb";
import { collections, filesBucket, fileContentsBucket } from "./db/db.ts";
import type { File } from "./db/types.ts";

export const FILE_MAX_BYTES = 100 * 1024 * 1024;

export class FileTooLargeError extends Error {
  status = 413;

  constructor() {
    super("File melebihi batas 100 MiB");
    this.name = "FileTooLargeError";
  }
}

export function openStoredFile(
  file: Pick<File, "_id" | "contentId">,
  options: GridFSBucketReadStreamOptions = {},
): Readable {
  if (file.contentId)
    return fileContentsBucket.openDownloadStream(
      new ObjectId(file.contentId),
      options,
    );
  return filesBucket.openDownloadStream(
    file._id as unknown as ObjectId,
    options,
  );
}

export function downloadStoredFile(
  filename: string,
  options: GridFSBucketReadStreamOptions = {},
  snapshot?: File,
): Readable {
  return Readable.from(
    (async function* () {
      const file =
        snapshot ?? (await collections.files.findOne({ _id: filename }));
      if (!file) throw new Error(`FileNotFound: ${filename}`);
      for await (const chunk of openStoredFile(file, options)) yield chunk;
    })(),
  );
}

async function removeContent(file: File): Promise<void> {
  if (file.contentId) {
    await fileContentsBucket.delete(new ObjectId(file.contentId));
  } else {
    // The public document may already describe a new version: remove only
    // legacy chunks, never the filename's current metadata document.
    await collections.fsChunks.deleteMany({ files_id: file._id });
  }
}

export async function replaceStoredFile(
  filename: string,
  metadata: Record<string, unknown>,
  input: Readable,
  maxBytes = Infinity,
): Promise<void> {
  const contentId = new ObjectId();
  const upload = fileContentsBucket.openUploadStreamWithId(contentId, filename);
  const uploaded = finished(upload, { cleanup: true });
  // An index/construct failure may occur while waiting for the first input
  // byte. Interrupt that wait rather than leaving an upload request hanging.
  void uploaded.catch((err) => {
    if (!input.destroyed) input.destroy(err);
  });
  let bytes = 0;
  try {
    for await (const value of input) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      bytes += chunk.length;
      if (bytes > maxBytes) throw new FileTooLargeError();
      // GridFS destroy/abort does not await in-flight chunk inserts. Await
      // every write and limit it to one insert before cleanup can begin;
      // otherwise a late insert can recreate chunks after bucket.delete().
      for (
        let offset = 0;
        offset < chunk.length;
        offset += upload.chunkSizeBytes
      ) {
        await new Promise<void>((resolve, reject) => {
          upload.write(
            chunk.subarray(offset, offset + upload.chunkSizeBytes),
            (err) => (err ? reject(err) : resolve()),
          );
        });
      }
    }
    upload.end();
    await uploaded;
  } catch (err) {
    input.destroy();
    upload.destroy();
    await uploaded.catch(() => undefined);
    // No chunk insert remains pending, even when there is no completed file.
    await fileContentsBucket.delete(contentId).catch(() => undefined);
    throw err;
  }
  const completed = upload.gridFSFile;
  if (!completed) throw new Error("uploaded file record missing");
  // Never delete completed bytes on a publication error: a lost DB response
  // can mean the pointer was committed. Retain them for recovery in that case.
  const previous = await collections.files.findOneAndReplace(
    { _id: filename },
    {
      filename,
      length: completed.length,
      chunkSize: completed.chunkSize,
      uploadDate: completed.uploadDate,
      metadata,
      contentId: contentId.toHexString(),
    },
    { upsert: true, returnDocument: "before", includeResultMetadata: false },
  );
  if (previous) await removeContent(previous).catch(() => undefined);
}

export async function deleteStoredFile(filename: string): Promise<void> {
  const previous = await collections.files.findOneAndDelete({ _id: filename });
  if (!previous) throw new Error(`FileNotFound: ${filename}`);
  await removeContent(previous);
}
