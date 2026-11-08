import { redact } from "../app-logger.ts";

// Bound bytes while reading, then redact again at the API boundary. No raw
// sink payload (including a malformed row) is sent to the browser or export.
export async function readLogResults(
  response: Response,
  limit: number,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    let reading = true;
    while (reading) {
      const result = await reader.read();
      if (result.done) {
        reading = false;
        continue;
      }
      size += result.value.byteLength;
      if (size > 50 * 1024 * 1024) throw new Error("LOG_RESULT_LIMIT");
      chunks.push(result.value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const lines = text.split("\n").filter(Boolean).slice(0, limit);
    return (
      lines.map((line) => JSON.stringify(redact(JSON.parse(line)))).join("\n") +
      (lines.length ? "\n" : "")
    );
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
