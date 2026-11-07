# Logging pipeline

Application logs flow one way:

```
app (engine/web/vpn, lib/app-logger.ts, redacted JSON lines)
  -> shared NDJSON volume (/logs/<service>/<service>.ndjson)
     -> Vector (schema gate + defense-in-depth redaction, disk buffer 1GiB)
        -> VictoriaLogs /insert/jsonline (_stream_fields=installationId,
           environment,service; _time_field=timestamp; _msg_field=message)
```

## Policy

- Redaction happens BEFORE persist: the application logger redacts sensitive
  keys, TR-069 secret parameter values (typed tuples and path suffixes) and URL
  credentials; Vector additionally deletes a fixed sensitive-key set from
  `details` (defense in depth). Malformed lines are DROPPED by Vector's schema
  gate — never forwarded raw.
- Availability: the app logger never blocks or throws on storage failure; it
  reports healthy/buffering/degraded with dropped counters. Vector buffers up to
  1GiB on disk (block when full) while VictoriaLogs is unavailable and drains on
  recovery.
- Retention (SOFT targets): 14 days and 10GiB max disk usage with a 2GiB
  free-disk floor
  (`-retentionPeriod=14d -retention.maxDiskSpaceUsageBytes=10000000000 -storage.minFreeDiskSpaceBytes=2147483648`).
  When the quota is hit, ACTUAL retention shortens — the age limit is the
  ceiling, not a guarantee. The test stack uses deliberately tiny quotas
  (1d/100MiB/10MiB floor).
- Exposure: VictoriaLogs 9428 and Vector internals stay on the internal network;
  nothing is published. Health status comes from evidence —
  `scripts/log-smoke.mjs` writes one sanitized event through the real path and
  validates the stored record — never from "container alive".

## Operations

```sh
# health/status evidence (from the deployment host or an internal node)
LOG_URL=http://victorialogs:9428 node scripts/log-smoke.mjs

# query by correlation id
curl -s http://victorialogs:9428/select/logsql/query \
  --data-urlencode 'query=requestId:"<uuid>"' --data-urlencode 'limit=10'
```

LogQL notes: field filters use `field:"value"` (`requestId:"..."`), not
`requestId="..."` — an invalid query returns an error body that echoes the id,
which is NOT a match.

## Fault behavior (verified in the harness)

- Sink (VictoriaLogs) stopped: Vector keeps reading and buffers on disk; apps
  keep running; the app logger stays healthy (its own sink is the local volume).
- Sink restarted: the buffered events drain and become searchable again.
- App log volume failing (ENOSPC): the app logger degrades with dropped counters
  and recovers when writes succeed again (unit-covered in test/app-logger.ts
  with stub sinks; the harness does not fill real disks).
- Log directory missing (fresh shared volume seeded by another service's image,
  or storage wiped mid-run): every writer creates its own directory up front and
  recreates it on ENOENT at runtime — writes never fail forever (unit-covered in
  test/app-logger.ts and test/engine-app-logger-broken-dir.ts). While the
  directory is genuinely uncreatable, the engine adapter reports `degraded` with
  lost events counted and heals by itself once storage is repaired.
