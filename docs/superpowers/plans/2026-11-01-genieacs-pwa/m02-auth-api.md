# M02 — Identitas dan adapter API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.
>
> Sesi ini hanya dokumentasi. Paket berstatus Planned; eksekusi hanya ketika
> prasyarat merged, desain ditinjau dan tiket pelaksanaan dipilih. Agen
> low-thinking mengambil satu paket/PR, bukan seluruh milestone sekaligus.

**Goal:** Identitas dan adapter API dengan acceptance tiap paket yang dapat
ditinjau mandiri.

**Architecture:** Gunakan kontrak dan fondasi dari milestone sebelumnya; setiap
paket menambah satu deliverable yang bisa diuji. Backend native tetap memeriksa
permission dan engine tidak ditulis ulang.

**Tech Stack:** Node24.22.2, TypeScript5.9.3, Next16.4.3/React19.3.1,
Mongo8.0.34/driver7.8.0, native GenieACS, Vector0.61.0/VictoriaLogs1.53.0; pin
dan security gate pada security-upgrade.md.

## Global Constraints

- Dokumen saja pada sesi perencanaan; eksekusi paket dimulai terpisah setelah
  review dan prasyarat merged.
- Baca [kontrak](../../../design/contracts.md),
  [aturan eksekusi](../2026-11-01-genieacs-pwa.md) dan
  [security gate](../../../design/security-upgrade.md) sebelum paket terkait.
- Frontend mobile first biru-putih; satu ISP, 10.000 ONT,20 operator,
  acuan4vCPU/8GiB/SSD, p95 daftar/filter≤2detik.
- Akun/permission native, sesi absolut8jam; tanpa antrean otomatis perintah
  gagal.
- Cache persisten hanya aset generik/offline; private API/HTML/RSC/device/secret
  tidak dicache.
- Satu L2TP aktif; dashboard independen; profil gagal dipertahankan, auth
  rejection pause sampai admin.
- Log JSON redacted sebelum persist; retensi14hari/10GB soft target/buffer1GiB;
  seluruh log storage gagal aplikasi tetap hidup + logging degraded.
- Release fork v1.2.N selalu patch+1; upstreamVersion terpisah; tag immutable.
- Semua command mutasi/test mengarah project **genieacs-pwa-check**, database
  **genieacs_plan_test**. Deployment referensi tidak dipakai sebagai target.
- Write set tiap paket mencakup scripts/check-suites.json untuk mendaftarkan
  perintah konkret, plus file yang dicantumkan; perubahan arsitektur/dependency
  lain direvisi melalui rencana.

---

## M02-A — Session native delapan jam dan bootstrap JSON aman

**Linear:**
[ARD-170](https://linear.app/ardani/issue/ARD-170/m02-a-session-native-delapan-jam-dan-bootstrap-json-aman).
**Status:** Planned / Backlog. **Prasyarat:** M01-F. **Branch:**
`feature/m02-a`.

**Read set:**

- `docs/design/contracts.md`
- `lib/ui.ts`
- `lib/ui/local-cache.ts`
- `lib/auth.ts`
- `lib/common/authorizer.ts`

**Write set (buat jika belum ada):**

- `lib/ui.ts`
- `lib/ui/app-api.ts`
- `lib/ui/session.ts`
- `lib/ui/self-password.ts`
- `test/session.ts`
- `test/helpers/app.ts`
- `test/fixtures/identities.json`
- `apps/web/src/server/genieacs-client.ts`
- `apps/web/src/app/api/app/login/route.ts`
- `apps/web/src/app/api/app/logout/route.ts`
- `apps/web/src/app/api/app/session/route.ts`
- `apps/web/src/app/api/app/password/route.ts`
- `scripts/check-suites.json`
- `apps/web/e2e/global-setup.ts`
- `apps/web/playwright.config.ts`

**Interfaces:** getSafeSession(ctx):SessionDTO;
issueSession(username,authMethod):native JWT exp8h;
requireSameOrigin(request,publicOrigin):void; test/helpers/app.ts exports
appRequest(path,init?,identity?):Promise<Response> using actual listener on
ephemeral loopback and fixture DB.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m02-a
```

- [ ] **2. Tambahkan tes perilaku pertama** pada `test/session.ts`. Assertion
      berikut adalah awal; skenario penerimaan langkah4 harus ditambahkan pada
      berkas tes write set.

```tsx
import test from "node:test";
import assert from "node:assert/strict";
import { appRequest } from "./helpers/app.ts";
test("session never serializes user secrets", async () => {
  const r = await appRequest("/api/session", {}, "operator");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.username, "operator");
  assert.ok(Date.parse(body.expiresAt) - Date.now() <= 28800000);
  assert.equal(JSON.stringify(body).includes("fixture-password-hash"), false);
  assert.equal(JSON.stringify(body).includes("fixture-salt"), false);
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M02-A
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Seed fixture users admin/operator/restricted using native
      generateSalt/hashPassword on dummy password Fixture-Only-2026!; fixture
      token helper calls actual /login. appRequest starts actual native
      listener/DB on test-only loopback, identity adds native cookie; no
      Authorizer mock for permission tests.
- [ ] Change jwt.sign expiresIn8h; middleware checks iat/exp finite and
      exp-iat<=28800 and exp now. Add /api/session returning selected
      username/roles/permissionSets/uiConfig/revision/version; use
      authorizer.getPermissionSets(), not users snapshot export.
- [ ] BFF internal client fixed GENIEACS_UI_URL, cookie forwarding only accepted
      name, no Authorization passthrough, cache no-store, AbortSignal timeouts,
      strips Set-Cookie from generic responses.
- [ ] Login BFF requireSameOrigin+X-App-Request1, rate10failed/15min
      IP+username, POST native then store native JWT
      HttpOnly/Lax/secure-by-origin/8h. Return safe session only, no JWT body.
      Native login cookie also explicit HttpOnly/maxAge so legacy route not
      weaker.
- [ ] Self-password backend authenticates current oldPassword using authLocal,
      hashes new password with native functions; requires logged-in user, not
      global userswrite. Admin password reset uses native users:id/password
      unchanged permission semantics. Return safe error same for wrong
      oldpassword.
- [ ] Logout clear native/BFF cookie, no-store, no redirect loops. Test live
      permission snapshot update/delete and absolute expiry with controlled
      clock/token fixtures. Invalid/missing exp rejected; no auto session
      renewal.

- [ ] Playwright global-setup login akun fixture via BFF dengan
      Origin+X-App-Request, simpan storageState admin/operator/restricted di
      artifacts/auth yang diignore Git. Config tidak memuat secret nyata; test
      anonymous memakai storageState kosong. Backend helper menutup listener/DB
      setelah suite.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M02-A: auth success/wrongpassword/expired/no-exp/deleteduser; roles change
reflected<=10s; 401 vs403; session no hash/salt/cwmp.auth; CSRF
missing/origindifferent403; rate429; HTTP cookie not Secure, HTTPS Secure;
password self/admin isolation. auth events correlate and redact.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'lib/ui.ts' 'lib/ui/app-api.ts' 'lib/ui/session.ts' 'lib/ui/self-password.ts' 'test/session.ts' 'test/helpers/app.ts' 'test/fixtures/identities.json' 'apps/web/src/server/genieacs-client.ts' 'apps/web/src/app/api/app/login/route.ts' 'apps/web/src/app/api/app/logout/route.ts' 'apps/web/src/app/api/app/session/route.ts' 'apps/web/src/app/api/app/password/route.ts' 'scripts/check-suites.json' 'apps/web/e2e/global-setup.ts' 'apps/web/playwright.config.ts'
git commit -m 'feat(auth): reuse native identity with bounded sessions'
git push -u origin feature/m02-a
```

Judul PR:
`[ARD-170] M02-A — Session native delapan jam dan bootstrap JSON aman`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** If bootstrap safe field selection cannot be proven,
stop before frontend session. Do not create second user DB or use NBI.
Cookie/token fixtures stay synthetic; no token appears in artifacts.

---

## M02-B — Allowlist BFF resources, pagination, file stream dan error

**Linear:**
[ARD-171](https://linear.app/ardani/issue/ARD-171/m02-b-allowlist-bff-resources-pagination-file-stream-dan-error).
**Status:** Planned / Backlog. **Prasyarat:** M02-A. **Branch:**
`feature/m02-b`.

**Read set:**

- `docs/design/contracts.md`
- `lib/ui/api.ts`
- `lib/ui/db.ts`

**Write set (buat jika belum ada):**

- `apps/web/src/server/resource-adapter.ts`
- `apps/web/src/server/mask-device.ts`
- `apps/web/src/lib/api-client.ts`
- `apps/web/src/app/api/app/resources/[resource]/route.ts`
- `apps/web/src/app/api/app/resources/[resource]/[id]/route.ts`
- `apps/web/src/app/api/app/resources/[resource]/csv/route.ts`
- `apps/web/src/app/api/app/devices/[id]/route.ts`
- `apps/web/src/app/api/app/files/[id]/content/route.ts`
- `apps/web/src/server/resource-adapter.test.ts`
- `packages/app-contracts/src/resources.ts`
- `test/integration/resource-access.ts`
- `lib/ui/app-api.ts`
- `scripts/check-suites.json`

**Interfaces:**
listResource<T>(resource:ResourceName,query:ListQuery):Promise<Page<T>>;
apiRequest<T>(path,init):Promise<ApiResult<T>>;
maskDeviceForUi(flatDevice):flatDevice. Streaming routes preserve
status/content-type/disposition/range without envelope.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m02-b
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `apps/web/src/server/resource-adapter.test.ts`. Assertion berikut adalah
      awal; skenario penerimaan langkah4 harus ditambahkan pada berkas tes write
      set.

```tsx
import { expect, test } from "vitest";
import { normalizeListQuery } from "./resource-adapter";
test("pagination is bounded and sort is stable", () => {
  expect(
    normalizeListQuery(
      { page: "2", pageSize: "25", sort: '{"DeviceID.SerialNumber":1}' },
      "devices",
    ),
  ).toMatchObject({
    skip: 25,
    limit: 25,
    sort: { "DeviceID.SerialNumber": 1, "DeviceID.ID": 1 },
  });
  expect(() => normalizeListQuery({ pageSize: "10000" }, "devices")).toThrow(
    "VALIDATION",
  );
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M02-B
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Map exact native resources+verbs: devices GET/DELETE, tasks GET, faults
      GET/DELETE, files GET/DELETE plus separate PUT octet stream /api/files/:id
      and GET /api/blob/files/:id; other admin resources GET/PUT/DELETE.
      Unmapped method405 Allow, unknownresource404.
- [ ] Validate page/pageSize/sort/projection/filter length<=8192. Native list
      limit/skip and separate HEAD count same filter; 403 count yields
      total=null, list403 remains FORBIDDEN. Stable ID sort. IDs
      encodeURIComponent once, never concatenate user path or query URL.
- [ ] Generic BFF path endpoints return ApiResult; classify upstream
      400/401/403/404/409/429/503/errors, never return raw body/stack. fetch
      no-store. Abort10s read, not mutation retry.
- [ ] Mask secrets in flat device values and CSV, user hash/salt excluded, no
      full request logger. Header/file ID safe content disposition; file
      upload≤100MiB streaming native PUT, native metadata headers allowlist.
      Abort upstream on browser cancel, checksum fixture in tests.
- [ ] Public CSV path /resources/:resource/csv maps native /api/:resource.csv;
      apply configured columns, native filter, cap10000 rows, escape formula
      cells. File/CSV are no-store streams and not JSON envelope.
- [ ] Add backend query budget/maxTimeMS only if explain shows path cannot
      honor10s; preserve arbitrary expression capability and permission
      intersection. Unit tests fake transport; integration uses restricted user
      DB source.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M02-B tests filtered counts/list, page2 stable withduplicate sort values,
totalnull withoutcountpermission, encodedIDs % slash Unicode, invalidsort,
forbiddenPUT, abortedfile, malformedbackendresponse, 10s timeout safe
error/requestId. No secret in response tables/export/logs.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'apps/web/src/server/resource-adapter.ts' 'apps/web/src/server/mask-device.ts' 'apps/web/src/lib/api-client.ts' 'apps/web/src/app/api/app/resources/[resource]/route.ts' 'apps/web/src/app/api/app/resources/[resource]/[id]/route.ts' 'apps/web/src/app/api/app/resources/[resource]/csv/route.ts' 'apps/web/src/app/api/app/devices/[id]/route.ts' 'apps/web/src/app/api/app/files/[id]/content/route.ts' 'apps/web/src/server/resource-adapter.test.ts' 'packages/app-contracts/src/resources.ts' 'test/integration/resource-access.ts' 'lib/ui/app-api.ts' 'scripts/check-suites.json'
git commit -m 'feat(api): add authorized resource adapter and bounded queries'
git push -u origin feature/m02-b
```

Judul PR:
`[ARD-171] M02-B — Allowlist BFF resources, pagination, file stream dan error`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** If native endpoint unavailable, return503 and keep
origin boundary; do not fall back to public NBI. Stop if file buffering exceeds
bound or unknown method passes allowlist.

---

## M02-C — Permission VPN/log, log search aman dan audit endpoint

**Linear:**
[ARD-172](https://linear.app/ardani/issue/ARD-172/m02-c-permission-vpnlog-log-search-aman-dan-audit-endpoint).
**Status:** Planned / Backlog. **Prasyarat:** M02-B. **Branch:**
`feature/m02-c`.

**Read set:**

- `docs/design/contracts.md`
- `lib/common/authorizer.ts`
- `lib/init.ts`

**Write set (buat jika belum ada):**

- `lib/ui/app-api.ts`
- `lib/ui/app-permissions.ts`
- `lib/ui/log-query.ts`
- `test/app-permissions.ts`
- `test/log-query.ts`
- `apps/web/src/app/api/app/logs/route.ts`
- `apps/web/src/app/api/app/logs/export/route.ts`
- `apps/web/src/app/api/app/vpn/status/route.ts`
- `apps/web/src/app/api/app/client-errors/route.ts`
- `packages/app-contracts/src/vpn.ts`
- `packages/app-contracts/src/log.ts`
- `scripts/check-suites.json`

**Interfaces:**
authorizeAppResource(authorizer,resource,access,object,mutation):void;
buildLogQuery(filters):{query,start,end,limit,offset}; queryLogs():NDJSON
stream. Device diagnostics use fixed fields plus devices filter, no arbitrary
logs query.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m02-c
```

- [ ] **2. Tambahkan tes perilaku pertama** pada `test/app-permissions.ts`.
      Assertion berikut adalah awal; skenario penerimaan langkah4 harus
      ditambahkan pada berkas tes write set.

```tsx
import test from "node:test";
import assert from "node:assert/strict";
import { buildLogQuery } from "../lib/ui/log-query.ts";
test("log query rejects unbounded windows and raw expressions", () => {
  assert.throws(
    () => buildLogQuery({ start: "2026-01-01", end: "2026-11-01" }),
    /VALIDATION/,
  );
  assert.throws(
    () => buildLogQuery({ query: "* | delete" } as any),
    /VALIDATION/,
  );
  const q = buildLogQuery({
    requestId: "123e4567-e89b-42d3-a456-426614174000",
  });
  assert.equal(q.limit, 100);
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M02-C
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Add vpn/logs to permission resource selectors/seed, preserve native
      expression filter/validator. Admin vpn3/logs3, operator vpn1/no logs;
      existing roles get no silent grants except explicit idempotent bootstrap
      migration with adminreview.
- [ ] App endpoint guard uses hasAccess+getFilter evaluated on installation
      resource+getValidator for mutation. Negative tests deviceswrite does not
      grant vpn/logs.
- [ ] Backend log query validates closed schema filters; default15min/max24h,
      limit100max500/offset5000, escapes LogsQL string literal, POST form to
      fixed internal origin, timeout5s. Stream NDJSON checked fields; export
      max10000/50MiB/30s, permissionlogs3.
- [ ] Native vpn/status proxies internal controller health/status with service
      token, emits unconfigured/unavailable until controller management M07;
      never reports connected from container health alone. No secret/profile
      exposed to vpn1.
- [ ] client-errors accepts only event/message/safe stack/location path,
      rate10/min/user, body16KiB, server associates actor+requestId. Audit
      logs.query/export with field names/count not resultbody.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M02-C admin search/export allowed, operator403 global log,
vpnstatusallowed/edit403; malicious query/timewindow/count rejected; log sink
down503 safe; invalidNDJSON handled error. Debug route cannot expose another
user's/device's records. Negative permission tests actual Authorizer.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'lib/ui/app-api.ts' 'lib/ui/app-permissions.ts' 'lib/ui/log-query.ts' 'test/app-permissions.ts' 'test/log-query.ts' 'apps/web/src/app/api/app/logs/route.ts' 'apps/web/src/app/api/app/logs/export/route.ts' 'apps/web/src/app/api/app/vpn/status/route.ts' 'apps/web/src/app/api/app/client-errors/route.ts' 'packages/app-contracts/src/vpn.ts' 'packages/app-contracts/src/log.ts' 'scripts/check-suites.json'
git commit -m 'feat(permissions): authorize VPN status and centralized log access'
git push -u origin feature/m02-c
```

Judul PR:
`[ARD-172] M02-C — Permission VPN/log, log search aman dan audit endpoint`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** If generic authorizer filter/validator semantics
are uncertain, stop and test rather than map role names directly in UI. Reject
raw log query, arbitrary diagnostics target and proxy URL inputs.

---
