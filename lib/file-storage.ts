// Public fs.files IDs remain native string filenames. New content is immutable
// in a separate bucket, so publishing a complete version is one atomic document
// replacement, including on standalone MongoDB (no GridFS transaction needed).
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
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
  let bytes = 0;
  const capped = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > maxBytes ? new FileTooLargeError() : null, chunk);
    },
  });
  try {
    await pipeline(input, capped, upload);
  } catch (err) {
    // GridFS can leave partial chunks after an interrupted upload. delete()
    // removes those too, even when no completed file document exists.
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
