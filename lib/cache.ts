import { collections } from "./db/db.ts";
import * as config from "./config.ts";

const CLOCK_SKEW_TOLERANCE = 30000;
const MAX_CACHE_TTL = +config.get("MAX_CACHE_TTL");

// Optional maxAge: treat entries older than maxAge milliseconds (or
// past their expire time) as missing. The local-cache revision hash
// uses this so permission/user changes propagate cross-process within
// one refresh window (contracts.md: effective ≤10s) instead of waiting
// for Mongo's TTL monitor on the stored entry.
export async function get(
  key: string,
  maxAge?: number,
): Promise<string | null> {
  const res = await collections.cache.findOne({ _id: key });
  if (!res) return null;
  const now = Date.now();
  if (res.expire && +new Date(res.expire) < now) return null;
  if (
    maxAge != null &&
    res.timestamp &&
    now - +new Date(res.timestamp) > maxAge
  )
    return null;
  return res.value ?? null;
}

export async function del(key: string): Promise<void> {
  await collections.cache.deleteOne({ _id: key });
}

export async function set(
  key: string,
  value: string,
  ttl: number = MAX_CACHE_TTL,
): Promise<void> {
  const timestamp = new Date();
  const expire = new Date(
    timestamp.getTime() + CLOCK_SKEW_TOLERANCE + ttl * 1000,
  );
  await collections.cache.replaceOne(
    { _id: key },
    { value, expire, timestamp },
    { upsert: true },
  );
}

export async function pop(key: string): Promise<string> {
  const res = await collections.cache.findOneAndDelete(
    { _id: key },
    { includeResultMetadata: true },
  );
  return res.value?.value;
}
