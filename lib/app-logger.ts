// Bounded, redacting JSON application logger shared by engine, web and
// vpn services. emit() NEVER throws or blocks: events flow through an
// in-memory queue (<=1000 events / 2MiB) to a single async file writer
// with rotation (20MiB x 5); on storage failure the logger records
// degraded state + dropped counters and the application keeps running.

import { randomUUID } from "node:crypto";
import { appendFile, rename } from "node:fs/promises";
import type {
  LogEvent,
  LogLevel,
  LoggerStatus,
  LoggingState,
} from "../packages/app-contracts/src/log.ts";

export const QUEUE_MAX_EVENTS = 1000;
export const QUEUE_MAX_BYTES = 2 * 1024 * 1024;
export const ROTATE_MAX_BYTES = 20 * 1024 * 1024;
export const ROTATE_KEEP = 5;
const REDACT_MAX_DEPTH = 10;
const REDACT_MAX_STRING = 8 * 1024;

// Case-insensitive secret-ish keys; also matched as path suffixes.
const SENSITIVE_KEYS = new Set(
  [
    "password",
    "passwd",
    "secret",
    "token",
    "apikey",
    "api_key",
    "authorization",
    "authpassword",
    "newpassword",
    "cookie",
    "set-cookie",
    "jwt",
    "presharedkey",
    "credentials",
    "privatekey",
  ].map((k) => k.toLowerCase()),
);

const REDACTED = "[REDACTED]";

// Session-bearing query parameters are credentials too: tokens and
// session ids in URLs are stripped alongside passwords.
function isSensitiveUrlKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return (
    isSensitiveKey(lowered) ||
    /token|session/.test(lowered) ||
    lowered === "sid"
  );
}

function isSensitiveKey(key: string): boolean {
  const lowered = key.toLowerCase();
  if (SENSITIVE_KEYS.has(lowered)) return true;
  const last = lowered.split(/[._-]/).pop() ?? lowered;
  return SENSITIVE_KEYS.has(last);
}

// Parameter paths whose VALUES are secrets even when the key alone looks
// benign (TR-069 style typed tuples and path suffixes).
const SENSITIVE_PATH_SUFFIXES = [
  "PreSharedKey",
  "Password",
  "KeyPassphrase",
  "Secret",
];

function sensitivePathSuffix(key: string): boolean {
  return SENSITIVE_PATH_SUFFIXES.some((s) => key.endsWith(s));
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username) url.username = REDACTED;
    if (url.password) url.password = REDACTED;
    for (const key of new Set(url.searchParams.keys()))
      if (isSensitiveUrlKey(key)) url.searchParams.set(key, REDACTED);
    return url.toString();
  } catch {
    return value;
  }
}

// Free text (log messages, Error.message, stack lines) is sanitized as
// a WHOLE: embedded URLs lose userinfo/credential query values, and
// explicit `key=value` / `key: value` pairs under sensitive names drop
// their value. Length stays bounded.
const SENSITIVE_KV =
  /\b(password|passwd|secret|token|api[_-]?key|apikey|authpassword|presharedkey|keypassphrase|credentials?|privatekey|jwt|session(?:id)?)\b(\s*"[^"]*"\s*|\s*'[^']*'\s*|\s*)([=:])[ \t]*("[^"]*"|'[^']*'|[^\s,;)}\]]+)/gi;

// Authorization values are scheme + credentials ("Bearer <token>",
// "Basic <b64>"): the WHOLE value must go, not just the first word the
// generic KV rule above would eat. Runs BEFORE SENSITIVE_KV (so
// `authorization` is absent from its alternation) and consumes the
// scheme plus every following word up to a delimiter or end of line —
// trailing prose words are deliberately over-redacted; a credential
// surviving beats a readable log line. The word boundary also catches
// Proxy-Authorization.
const AUTH_HEADER =
  /\b(authorization)\b(\s*"[^"]*"\s*|\s*'[^']*'\s*|\s*)([=:])[ \t]*("[^"]*"|'[^']*'|[^\s,;)}\]]+(?:[ \t]+[^\s,;)}\]]+)*)/gi;

export function sanitizeText(text: string): string {
  let out = text.slice(0, REDACT_MAX_STRING);
  out = out.replace(/https?:\/\/\S+/g, (m) => redactUrl(m));
  out = out.replace(AUTH_HEADER, "$1$2$3 [REDACTED]");
  out = out.replace(SENSITIVE_KV, "$1$2$3 [REDACTED]");
  if (out.length > REDACT_MAX_STRING)
    out = out.slice(0, REDACT_MAX_STRING) + "…";
  return out;
}

function sanitizeStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  // Stack lines carry the error message (and sometimes request URLs);
  // every line is sanitized, then line/size capped.
  return stack
    .split("\n")
    .slice(0, 20)
    .map(sanitizeText)
    .join("\n")
    .slice(0, REDACT_MAX_STRING);
}

// Recursive redaction with cycle guard and depth/size bounds. Values
// under sensitive keys and TR-069 secret parameter paths become
// [REDACTED]; URL userinfo/query tokens are stripped; Error objects keep
// name/message-redacted/stack-sanitized; `cause` chains are sanitized
// too. Generic property values outside an event's details allowlist are
// not persisted by the event factory (see makeEvent).
export function redact(
  value: unknown,
  depth = 0,
  seen = new WeakSet(),
): unknown {
  if (depth > REDACT_MAX_DEPTH) return "[TRUNCATED]";
  if (value === null || value === undefined) return value;

  const type = typeof value;
  if (type === "string") {
    const str = value as string;
    if (/^https?:\/\//.test(str)) return redactUrl(str);
    // Embedded URLs and explicit secret key=value pairs inside longer
    // strings are scrubbed too; length stays bounded.
    return sanitizeText(str);
  }
  if (type === "number" || type === "boolean") return value;
  if (type === "bigint" || type === "symbol" || type === "function")
    return String(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      // Error messages are free text: sanitize as a whole (URL
      // credentials, explicit secret key=value pairs).
      message: sanitizeText(String(value.message)),
      stack: sanitizeStack(value.stack),
      ...(value.cause !== undefined
        ? { cause: redact(value.cause, depth + 1, seen) }
        : {}),
    };
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return "[CYCLE]";
    seen.add(value);
    // TR-069 typed tuples are [path, value, type]: the value right after
    // a sensitive parameter path is redacted positionally.
    const out = value.map((v, i) => {
      const prev = value[i - 1];
      if (
        i > 0 &&
        typeof prev === "string" &&
        sensitivePathSuffix(prev) &&
        typeof v === "string" &&
        !/^xsd:/.test(v)
      )
        return REDACTED;
      return redact(v, depth + 1, seen);
    });
    seen.delete(value);
    return out;
  }

  if (type === "object") {
    if (seen.has(value as object)) return "[CYCLE]";
    seen.add(value as object);
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key) || sensitivePathSuffix(key)) {
        out[key] = REDACTED;
        continue;
      }
      out[key] = redact(v, depth + 1, seen);
    }
    seen.delete(value as object);
    return out;
  }

  return REDACTED;
}

export interface AppLoggerOptions {
  service: string;
  appVersion: string;
  installationId: string;
  environment: "test" | "production";
  filePath: string;
  // Injectable sink for tests; defaults to appendFile with rotation.
  sink?: (line: string) => Promise<void>;
  flushTimeoutMs?: number;
}

export interface AppLogger {
  emit(event: Partial<LogEvent> & { event: string; level: LogLevel }): void;
  status(): LoggerStatus;
  flush(timeoutMs?: number): Promise<void>;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function createAppLogger(options: AppLoggerOptions): AppLogger {
  const queue: string[] = [];
  let queuedBytes = 0;
  let state: LoggingState = "healthy";
  let droppedEvents = 0;
  let lastSuccessAt: string | null = null;
  let writing = false;
  let currentBytes = 0;

  const sink =
    options.sink ??
    (async (line: string) => {
      await appendFile(options.filePath, line + "\n");
      currentBytes += line.length + 1;
      if (currentBytes >= ROTATE_MAX_BYTES) {
        for (let i = ROTATE_KEEP - 1; i > 0; --i) {
          try {
            await rename(
              `${options.filePath}.${i}`,
              `${options.filePath}.${i + 1}`,
            );
          } catch {
            // older file may not exist
          }
        }
        try {
          await rename(options.filePath, `${options.filePath}.1`);
        } catch {
          // nothing to rotate yet
        }
        currentBytes = 0;
      }
    });

  const drain = (): void => {
    if (writing || queue.length === 0) return;
    writing = true;
    const batch = queue.splice(0, queue.length);
    queuedBytes = 0;
    void (async () => {
      try {
        for (const line of batch) await sink(line);
        lastSuccessAt = new Date().toISOString();
        if (state === "degraded") state = "healthy";
      } catch {
        state = "degraded";
        // The batch is already dropped from the queue: count it.
        droppedEvents += batch.length;
      } finally {
        writing = false;
        if (queue.length > 0) drain();
      }
    })();
  };

  return {
    emit(partial) {
      const event: LogEvent = {
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        level: partial.level,
        service: options.service,
        appVersion: options.appVersion,
        installationId: options.installationId,
        environment: options.environment,
        event: partial.event,
        // Free-text messages pass through the same whole-text
        // sanitization as error messages.
        message: sanitizeText(partial.message ?? partial.event),
        ...(partial.requestId ? { requestId: partial.requestId } : {}),
        ...(partial.operationId ? { operationId: partial.operationId } : {}),
        ...(partial.actorId ? { actorId: partial.actorId } : {}),
        ...(partial.deviceId ? { deviceId: partial.deviceId } : {}),
        ...(partial.taskId ? { taskId: partial.taskId } : {}),
        ...(partial.durationMs !== undefined
          ? { durationMs: partial.durationMs }
          : {}),
        ...(partial.outcome ? { outcome: partial.outcome } : {}),
        ...(partial.error
          ? {
              error: {
                code: partial.error.code,
                name: partial.error.name,
                ...(partial.error.stack
                  ? { stack: sanitizeStack(partial.error.stack) }
                  : {}),
              },
            }
          : {}),
        // details pass through redaction; unknown generic values inside
        // details are redacted/bounded by the recursive walker.
        ...(partial.details
          ? { details: redact(partial.details) as Record<string, unknown> }
          : {}),
      };

      const line = JSON.stringify(event);
      const size = Buffer.byteLength(line, "utf8");

      if (
        queue.length >= QUEUE_MAX_EVENTS ||
        queuedBytes + size > QUEUE_MAX_BYTES
      ) {
        // Overflow policy: shed the LOWEST severity first. If the
        // incoming event itself is at or below the queue's minimum
        // severity, drop the incoming event; otherwise evict a
        // minimum-severity queued item. Errors never lose their slot to
        // debug noise.
        const minQueued = queue.reduce(
          (min, l) =>
            Math.min(
              min,
              LEVEL_ORDER[(JSON.parse(l).level as LogLevel) ?? "info"],
            ),
          3 as number,
        );
        droppedEvents += 1;
        state = state === "healthy" ? "buffering" : state;
        if (LEVEL_ORDER[event.level] <= minQueued) return; // drop incoming
        const victim = queue.findIndex(
          (l) =>
            LEVEL_ORDER[(JSON.parse(l).level as LogLevel) ?? "info"] ===
            minQueued,
        );
        const removed = queue.splice(victim >= 0 ? victim : 0, 1)[0];
        queuedBytes -= Buffer.byteLength(removed, "utf8");
      }

      queue.push(line);
      queuedBytes += size;
      // Never throws: drain catches storage errors internally.
      try {
        drain();
      } catch {
        state = "degraded";
        droppedEvents += 1;
      }
    },

    status() {
      return { state, droppedEvents, lastSuccessAt };
    },

    flush(timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      return new Promise<void>((resolve) => {
        // Ref'd poll: an unref'd chain would let the process exit with
        // the queue undrained when nothing else is pending.
        const timer = setInterval(() => {
          if (queue.length === 0 && !writing) {
            clearInterval(timer);
            resolve();
          } else if (Date.now() >= deadline) {
            clearInterval(timer);
            resolve();
          }
        }, 10);
        drain();
      });
    },
  };
}

// Request context: generates the correlation UUID propagated across
// web -> engine -> vpn (X-Request-Id). Only valid UUIDs are accepted as
// parent ids.
export function makeRequestId(parent?: string | null): string {
  if (
    parent &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      parent,
    )
  )
    return parent;
  return randomUUID();
}
