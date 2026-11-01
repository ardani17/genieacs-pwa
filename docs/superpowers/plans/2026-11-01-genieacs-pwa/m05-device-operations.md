# M05 — Task, WAN, WiFi dan patch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.
>
> Sesi ini hanya dokumentasi. Paket berstatus Planned; eksekusi hanya ketika
> prasyarat merged, desain ditinjau dan tiket pelaksanaan dipilih. Agen
> low-thinking mengambil satu paket/PR, bukan seluruh milestone sekaligus.

**Goal:** Task, WAN, WiFi dan patch dengan acceptance tiap paket yang dapat
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

## M05-A — Migrasi model WAN dan seluruh regresi firmware

**Linear:**
[ARD-179](https://linear.app/ardani/issue/ARD-179/m05-a-migrasi-model-wan-dan-seluruh-regresi-firmware).
**Status:** Planned / Backlog. **Prasyarat:** M04-C. **Branch:**
`feature/m05-a`.

**Read set:**

- `docs/design/contracts.md`
- `docs/design/feature-parity.md`
- `docs/design/reference-wan-model.md`
- `docs/design/reference-wan-ui.md`

**Write set (buat jika belum ada):**

- `packages/device-profiles/src/wan-model.ts`
- `packages/device-profiles/src/wan-types.ts`
- `packages/device-profiles/src/wan-model.test.ts`
- `packages/device-profiles/src/management-wan.ts`
- `packages/device-profiles/src/management-wan.test.ts`
- `test/fixtures/devices.ts`
- `scripts/check-suites.json`
- `lib/ui/app-api.ts`
- `apps/web/src/app/api/app/devices/[id]/profile/route.ts`

**Interfaces:** Port WanDevice/WanSettings/WanValue/WanTask and exported
buildWanTask/connectionModes/readSettings/activeManagementWan from frozen
reference. assertManagementWanSafe(device,tasks):void, ambiguous
destructiveWAN=>VALIDATION.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m05-a
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `packages/device-profiles/src/wan-model.test.ts`. Assertion berikut adalah
      awal; skenario penerimaan langkah4 harus ditambahkan pada berkas tes write
      set.

```tsx
import { test, expect } from "vitest";
import { makeZte } from "../../../test/fixtures/devices";
import { buildWanTask, readSettings } from "./wan-model";
test("F670 P3N19 IP bridge has corrected service, enum and NAT", () => {
  const d = makeZte({ model: "F670", firmware: "V6.0.10P3N19", id: "TEST-1" });
  const c =
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection";
  const s = {
    ...readSettings(d, c + ".1"),
    mode: "bridge",
    service: "OTHER",
    enable: true,
    lanBind: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2",
  };
  const t = buildWanTask(d, c, c + ".1", s);
  const v = Object.fromEntries(t.parameterValues.map(([p, x]) => [p, x]));
  expect(v[c + ".1.ConnectionType"]).toBe("IP_Bridged");
  expect(v[c + ".1.X_ZTE-COM_ServiceList"]).toBe("INTERNET");
  expect(v[c + ".1.NATEnabled"]).toBe(false);
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M05-A
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Salin model pure dari reference-wan-model.md ke package, pertahankan
      nama/type/aturan persis; port20tes model ke runner baru tanpa dependency
      renderer.
- [ ] Resolver membatasi WAN khusus ke tiga firmware terverifikasi. Koreksi
      IP_Bridged hanya WAN IP; service OTHER→INTERNET hanya F670 P3N19 bridge.
      WAN PPP mengikuti capability.
- [ ] Pertahankan complete typed values, nama relatif AddObject,
      VLAN1–4094/prioritas0–7, untagged eksplisit, validasi IP/mask/DNS,
      writable flag dan password kosong=keep.
- [ ] Perkuat guard manajemen: cocokkan host CRURL dengan ExternalIPAddress; DNS
      memakai hasil resolusi yang diberikan server. Delete/SPV kritis pada WAN
      manajemen atau identitas ambigu ditolak, edit WAN lain tetap diizinkan.
- [ ] Tes seluruh patch parity, tiga firmware positif, firmware lain negatif,
      serta guard raw write/delete. Perubahan assertion lama harus menjelaskan
      perilaku guard server yang sengaja diperkuat.
- [ ] Endpoint profile memakai devices:2+filter native, mengembalikan
      DeviceProfile/capability tanpa secret; BFF route fixed internal origin,
      private/no-store.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M05-A all20modelregressions plus3firmwarepositive+unknownnegative,
VLANblank/firstID/untagged, PPPsecret, typedboolean, read-only, binding
validation, managerrawguard. No realdevicecommands.
Recordwhichassertionschangedforintentionalnewserverguard.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'packages/device-profiles/src/wan-model.ts' 'packages/device-profiles/src/wan-types.ts' 'packages/device-profiles/src/wan-model.test.ts' 'packages/device-profiles/src/management-wan.ts' 'packages/device-profiles/src/management-wan.test.ts' 'test/fixtures/devices.ts' 'scripts/check-suites.json' 'lib/ui/app-api.ts' 'apps/web/src/app/api/app/devices/[id]/profile/route.ts'
git commit -m 'feat(wan): port verified model rules and guard management paths'
git push -u origin feature/m05-a
```

Judul PR: `[ARD-179] M05-A — Migrasi model WAN dan seluruh regresi firmware`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** Any oldtestfailure requires specificbusinessreason;
do not weaken firmwareconditions or substitutePPPoE_Bridged everywhere. Readset
reference is docs, no deploymentdependency.

---

## M05-B — Executor task native, idempotensi dan hasil akurat

**Linear:**
[ARD-180](https://linear.app/ardani/issue/ARD-180/m05-b-executor-task-native-idempotensi-dan-hasil-akurat).
**Status:** Planned / Backlog. **Prasyarat:** M05-A. **Branch:**
`feature/m05-b`.

**Read set:**

- `docs/design/contracts.md`
- `lib/ui/api.ts`
- `lib/api-functions.ts`
- `lib/session.ts`

**Write set (buat jika belum ada):**

- `lib/ui/device-commands.ts`
- `lib/ui/operation-store.ts`
- `lib/ui/app-api.ts`
- `lib/ui/api.ts`
- `packages/app-contracts/src/commands.ts`
- `test/device-commands.ts`
- `test/operation-store.ts`
- `apps/web/src/app/api/app/devices/[id]/commands/route.ts`
- `apps/web/src/app/api/app/operations/[operationId]/route.ts`
- `scripts/check-suites.json`

**Interfaces:**
executeAuthorizedTasks(ctx,request:DeviceCommandRequest):Promise<CommandOutcome>;
claimOperation(opId,user,device,kind,HMAC):new|existing|conflict. Existing
/devices/:id/tasks routes call sameguard/executor, maintain legacy
responseadapter.
normalizeTaskOutcome({status:string,tasks:{status:string}[]}):{state:OperationState};
done only if every task done and no failurestatus.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m05-b
```

- [ ] **2. Tambahkan tes perilaku pertama** pada `test/device-commands.ts`.
      Assertion berikut adalah awal; skenario penerimaan langkah4 harus
      ditambahkan pada berkas tes write set.

```tsx
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTaskOutcome } from "../lib/ui/device-commands.ts";
test("pending and CR failure cannot become success", () => {
  assert.equal(
    normalizeTaskOutcome({ status: "Connection request failed", tasks: [] })
      .state,
    "failed",
  );
  assert.equal(
    normalizeTaskOutcome({ status: "", tasks: [{ status: "pending" }] }).state,
    "unknown",
  );
  assert.equal(
    normalizeTaskOutcome({ status: "", tasks: [{ status: "done" }] }).state,
    "succeeded",
  );
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M05-B
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Ekstrak alur native
      Authorizer/filter/validator/lock/insertion/CR/await-session/removal ke
      executor. Validasi dan guard terjadi sebelum insert. Route legacy memakai
      helper yang sama dengan adapter response lama.
- [ ] Validasi whitelist Task, field, typed SPV dan object path; max100 di
      server, device dari URL dan \_id client dibuang. Pertahankan expiry native
      dan cleanup tanpa membuat antrean persisten.
- [ ] app_operations memiliki unique operationId dan TTL24jam. Claim atomik
      menyimpan HMAC body canonical; ID sama/fingerprint sama mengembalikan
      hasil yang ada, fingerprint berbeda409.
- [ ] CR failure/fault/error menjadi failed; pending/timeout/konfirmasi hilang
      menjadi unknown; phase sebagian berhasil menjadi partial. Success
      memerlukan seluruh hasil yang disyaratkan benar-benar selesai.
- [ ] Startup mengubah operasi in_progress proses mati menjadi unknown, tanpa
      replay. Result lookup memeriksa owner/device permission. Disconnect
      browser tidak menghapus bukti operasi.
- [ ] Log started/completed/phase memuat korelasi/target/taskID/code/durasi,
      tanpa payload task. Finally selalu melepas lock dan membersihkan task
      percobaan sesuai native.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M05-B test actualAuthorizer deny/noinsert,101tasksreject,
managementrawdelete/SPVreject, sameoperationtwopost=>oneinsert,
differentbody409,CRnonOK,fault9003,pending,120stimeout,disconnectunknown,cleanupfinally,
crashno-replay. Existingtasknativependingcleanup remains.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'lib/ui/device-commands.ts' 'lib/ui/operation-store.ts' 'lib/ui/app-api.ts' 'lib/ui/api.ts' 'packages/app-contracts/src/commands.ts' 'test/device-commands.ts' 'test/operation-store.ts' 'apps/web/src/app/api/app/devices/[id]/commands/route.ts' 'apps/web/src/app/api/app/operations/[operationId]/route.ts' 'scripts/check-suites.json'
git commit -m 'feat(tasks): enforce guarded single attempt device commands'
git push -u origin feature/m05-b
```

Judul PR:
`[ARD-180] M05-B — Executor task native, idempotensi dan hasil akurat`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** Stop if helper refactor changes cleanup/queue
semantics or errorbecomessuccess. DBdown beforeclaim means no tasksent; DBdown
aftertask recordsunknown and warns, never automaticresubmit.

---

## M05-C — Orkestrasi WAN bertahap dan pemulihan hasil parsial

**Linear:**
[ARD-181](https://linear.app/ardani/issue/ARD-181/m05-c-orkestrasi-wan-bertahap-dan-pemulihan-hasil-parsial).
**Status:** Planned / Backlog. **Prasyarat:** M05-B. **Branch:**
`feature/m05-c`.

**Read set:**

- `docs/design/contracts.md`
- `docs/design/reference-wan-ui.md`
- `packages/device-profiles/src/wan-model.ts`

**Write set (buat jika belum ada):**

- `lib/ui/wan-operations.ts`
- `lib/ui/app-api.ts`
- `test/wan-operations.ts`
- `apps/web/src/app/api/app/devices/[id]/wan/route.ts`
- `packages/app-contracts/src/wan.ts`
- `scripts/check-suites.json`

**Interfaces:**
executeWanOperation(ctx,{operationId,deviceId,collection,instance,settings}):Promise<CommandOutcome>;
phase names write,refresh,reapply_binding,verify. Lock targetdevice+WAN; outcome
sharedoperationstore.
runWanPhases(steps:{write():Promise<{state:OperationState}>,refresh():Promise<{state:OperationState}>,reapplyBinding():Promise<{state:OperationState}>}):Promise<{state:OperationState}>
for deterministic phase tests.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m05-c
```

- [ ] **2. Tambahkan tes perilaku pertama** pada `test/wan-operations.ts`.
      Assertion berikut adalah awal; skenario penerimaan langkah4 harus
      ditambahkan pada berkas tes write set.

```tsx
import test from "node:test";
import assert from "node:assert/strict";
import { runWanPhases } from "../lib/ui/wan-operations.ts";
test("failed refresh prevents binding reapply", async () => {
  const calls: string[] = [];
  const result = await runWanPhases({
    write: async () => {
      calls.push("write");
      return { state: "succeeded" };
    },
    refresh: async () => {
      calls.push("refresh");
      return { state: "failed" };
    },
    reapplyBinding: async () => {
      calls.push("binding");
      return { state: "succeeded" };
    },
  } as any);
  assert.deepEqual(calls, ["write", "refresh"]);
  assert.equal(result.state, "partial");
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M05-C
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Ambil device fresh berizin, resolve profil, validasi WanSettings, bangun
      task lengkap di server dan ambil lock device/WAN sebelum write. Payload
      parameter browser bukan sumber kebenaran.
- [ ] Jalankan write sekali; gagal/unknown menghentikan fase berikut. Setelah
      berhasil, refresh tree WAN dan cocokkan instance/nilai aktual.
- [ ] Jika mode existing berubah ke bridge dan refresh berhasil, periksa
      binding; reapply binding yang hilang lalu verify fresh read. Refresh gagal
      menghentikan reapply.
- [ ] AddObject yang meninggalkan instance kosong/disabled menghasilkan partial
      dengan observed instance. Tawarkan refresh/edit manual; tidak recreate
      atau delete otomatis.
- [ ] Pembersihan fault hanya superseded9003 target terkait/virtual PPP terkait
      serta memerlukan fault write+validator. Tanpa izin, pertahankan fault dan
      tampilkan warning.
- [ ] Catat hasil setiap fase ke operation store; periksa ulang permission
      sebelum follow-up. Perubahan izin menghentikan operasi sebagai partial;
      settings/password tidak masuk log.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M05-C
writefailnorefresh,refreshfailnobinding,successfulbridgebindingreapply,verifyfailpartial,AddObjectleftinstancepartial,duplicateoperationnoinsert,concurrenttarget409,scopefaultcleanupnegative.
F670P3N19/P3N3/F609fixtureintegration and managementWAN guard.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'lib/ui/wan-operations.ts' 'lib/ui/app-api.ts' 'test/wan-operations.ts' 'apps/web/src/app/api/app/devices/[id]/wan/route.ts' 'packages/app-contracts/src/wan.ts' 'scripts/check-suites.json'
git commit -m 'feat(wan): preserve phased binding repair and partial results'
git push -u origin feature/m05-c
```

Judul PR:
`[ARD-181] M05-C — Orkestrasi WAN bertahap dan pemulihan hasil parsial`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** Unknown instance afterAddObject:
returnunknown/partial, requestmanualrefresh, nevercreateanotherobject.
Recoverymanual requiresnewoperationId and freshdevice. No automatic
durablequeue.

---

## M05-D — Task staging, editor WAN dan operasi perangkat mobile

**Linear:**
[ARD-182](https://linear.app/ardani/issue/ARD-182/m05-d-task-staging-editor-wan-dan-operasi-perangkat-mobile).
**Status:** Planned / Backlog. **Prasyarat:** M05-C. **Branch:**
`feature/m05-d`.

**Read set:**

- `docs/design/contracts.md`
- `docs/design/reference-wan-ui.md`

**Write set (buat jika belum ada):**

- `apps/web/src/features/tasks/staging-store.ts`
- `apps/web/src/features/tasks/staging-panel.tsx`
- `apps/web/src/features/tasks/operation-result.tsx`
- `apps/web/src/features/wan/wan-editor.tsx`
- `apps/web/src/features/wan/wan-form.tsx`
- `apps/web/src/features/wan/wan-editor.test.tsx`
- `apps/web/src/app/(dashboard)/tasks/page.tsx`
- `apps/web/e2e/device-commands.spec.ts`
- `scripts/check-suites.json`

**Interfaces:** StagingStore in-memory max100, stage/review/remove/commit;
WanEditor controlled by {deviceId,collection,instance}. Commit
createsoperationIdonce anddoesnotretry. Task result rendersallphases.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m05-d
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `apps/web/src/features/wan/wan-editor.test.tsx`. Assertion berikut adalah
      awal; skenario penerimaan langkah4 harus ditambahkan pada berkas tes write
      set.

```tsx
import { test, expect } from "@playwright/test";
test("unknown command result never shows success toast", async ({ page }) => {
  await page.goto("/devices/TEST-F670");
  await page.getByRole("button", { name: "Reboot", exact: true }).click();
  await page.getByLabel("Konfirmasi ID perangkat").fill("TEST-F670");
  await page.route("**/commands", (r) => r.abort("failed"));
  await page.getByRole("button", { name: "Jalankan", exact: true }).click();
  await expect(
    page.getByText("Hasil belum terkonfirmasi", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Berhasil", { exact: true })).toHaveCount(0);
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M05-D
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Staging memakai memory, max100, menolak konflik target WAN sama dan
      memasking ringkasan secret. Tidak memakai persistent browser storage.
- [ ] Semua entry Atur/Tambah/tabel/virtual PPP membuka satu editor WAN lengkap.
      VLAN pertama tetap dapat diisi; bridge aktif wajib binding; firmware tak
      dikenal read-only.
- [ ] Review commit menampilkan target/risiko. operationId dibuat sekali untuk
      submit, busy mencegah double click, hasil dicari melalui ID tanpa replay.
      Offline/unreachable menonaktifkan mutation.
- [ ] Reboot/factoryReset/download/refresh/raw typed SPV/addObject/deleteObject
      mengikuti native Task. Factory reset memerlukan konfirmasi deviceId;
      firmware memakai file berizin dan FS URL.
- [ ] Pergantian target/open/close membuang secret dan state form lama.
      Port22assertion perilaku UI referensi menjadi React tests dengan
      payload/outcome assertions.
- [ ] Bulk max100 target, concurrency4, hasil per device; cancel hanya mencegah
      target yang belum dikirim. Logout menggugurkan staging dan state akun.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M05-D reference22UIregressions mapped totests, tablet/mobile keyboarddialogs,
blankexistingpassword omittedpayload, newPPPmandatory, modesfromcapability,
bridgepartialphasevisible. Networkfailure/noHTTPok/timeout notsuccesstoast.
Bulkpermissionsfilters recheckedperserver.

Browser suite production test stack:

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm browser-tests npm run test:e2e -- e2e/device-commands.spec.ts
```

Expected browser: viewport relevan PASS, screenshot/report tersedia, console
error tak terduga gagal. Gunakan `../../artifacts/auth/admin.json` untuk admin,
operator.json untuk operator dan state kosong untuk anonymous; helper M02-A
membuatnya dari akun dummy. Path relatif cwd apps/web.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'apps/web/src/features/tasks/staging-store.ts' 'apps/web/src/features/tasks/staging-panel.tsx' 'apps/web/src/features/tasks/operation-result.tsx' 'apps/web/src/features/wan/wan-editor.tsx' 'apps/web/src/features/wan/wan-form.tsx' 'apps/web/src/features/wan/wan-editor.test.tsx' 'apps/web/src/app/(dashboard)/tasks/page.tsx' 'apps/web/e2e/device-commands.spec.ts' 'scripts/check-suites.json'
git commit -m 'feat(tasks): add mobile staging and unified WAN editor'
git push -u origin feature/m05-d
```

Judul PR:
`[ARD-182] M05-D — Task staging, editor WAN dan operasi perangkat mobile`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** Stop if Reacttest only
checksrenderwithoutpayload/resultassertions. Firmwaredownload
requiresfixturefileandFSreachability; do not selectproductionfirmware
automatically.

---

## M05-E — WiFi, tag, fault dan parameter action parity

**Linear:**
[ARD-183](https://linear.app/ardani/issue/ARD-183/m05-e-wifi-tag-fault-dan-parameter-action-parity).
**Status:** Planned / Backlog. **Prasyarat:** M05-D. **Branch:**
`feature/m05-e`.

**Read set:**

- `docs/design/contracts.md`
- `docs/design/feature-parity.md`
- `ui/components/parameter-table.ts`

**Write set (buat jika belum ada):**

- `packages/device-profiles/src/wifi.ts`
- `packages/device-profiles/src/wifi.test.ts`
- `apps/web/src/features/wifi/wifi-manager.tsx`
- `apps/web/src/features/devices/tag-editor.tsx`
- `apps/web/src/features/devices/parameter-actions.tsx`
- `apps/web/src/app/(dashboard)/faults/page.tsx`
- `apps/web/src/app/api/app/devices/[id]/tags/route.ts`
- `apps/web/e2e/wifi-faults.spec.ts`
- `scripts/check-suites.json`

**Interfaces:** readWifi(device):WifiRadio[];
buildWifiTask(device,ssidPath,{enabled,ssid,passwordAction,password?}):Task;
types WifiRadio{id,ssidPath,ssid,enabled,writable,band?:string,keyPath?:string}.
BindWAN remains separate.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m05-e
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `packages/device-profiles/src/wifi.test.ts`. Assertion berikut adalah
      awal; skenario penerimaan langkah4 harus ditambahkan pada berkas tes write
      set.

```tsx
import { test, expect } from "vitest";
import { buildWifiTask } from "./wifi";
test("keeping existing WiFi key never writes a blank password", () => {
  const d = {
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.SSID": {
      value: ["Lab", "xsd:string"],
      writable: true,
    },
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2.Enable": {
      value: [true, "xsd:boolean"],
      writable: true,
    },
  };
  const t = buildWifiTask(
    d,
    "InternetGatewayDevice.LANDevice.1.WLANConfiguration.2",
    { ssid: "Lab2", enabled: true, passwordAction: "keep" },
  );
  expect(t.parameterValues.some(([n]) => /Key|Password/.test(n))).toBe(false);
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M05-E
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Temukan WLANConfiguration TR098 atau relasi SSID/AccessPoint TR181 dari
      path dan referensi aktual. Band tidak diasumsikan dari nomor SSID. Mapping
      key ambigu membuat write key unsupported.
- [ ] Validasi SSID1–32byteUTF8, Enable boolean, WPA-PSK8–63karakter/64hex hanya
      jika security mode sesuai profil. Password existing keep; secret dihapus
      setelah submit.
- [ ] Tag memakai body add/remove native dan Authorizer; bulk menggunakan
      concurrency4 M05-D. Tidak menambah modul CRM pelanggan.
- [ ] Fault list/detail/filter/pagination/delete tetap berizin.
      Refresh/write/add/delete parameter memakai executor dan guard M05-B, typed
      editor serta konfirmasi destructive.
- [ ] Bukti CWMP fresh read diberi label verifikasi konfigurasi. Asosiasi WiFi,
      DHCP dan trafik fisik baru dinilai melalui lab M09-B.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

SSID rename/Enable terpisah dari binding WAN; keep key tidak menulis kosong;
replacement key tidak muncul di tabel/log/cache; unsupported security mode
ditolak. Tes tag/fault delete tanpa izin, guard raw delete, hasil task
gagal/unknown dan keyboard mobile. Trafik fisik diperiksa M09-B.

Browser suite production test stack:

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm browser-tests npm run test:e2e -- e2e/wifi-faults.spec.ts
```

Expected browser: viewport relevan PASS, screenshot/report tersedia, console
error tak terduga gagal. Gunakan `../../artifacts/auth/admin.json` untuk admin,
operator.json untuk operator dan state kosong untuk anonymous; helper M02-A
membuatnya dari akun dummy. Path relatif cwd apps/web.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'packages/device-profiles/src/wifi.ts' 'packages/device-profiles/src/wifi.test.ts' 'apps/web/src/features/wifi/wifi-manager.tsx' 'apps/web/src/features/devices/tag-editor.tsx' 'apps/web/src/features/devices/parameter-actions.tsx' 'apps/web/src/app/(dashboard)/faults/page.tsx' 'apps/web/src/app/api/app/devices/[id]/tags/route.ts' 'apps/web/e2e/wifi-faults.spec.ts' 'scripts/check-suites.json'
git commit -m 'feat(devices): add WiFi and remaining operational actions'
git push -u origin feature/m05-e
```

Judul PR: `[ARD-183] M05-E — WiFi, tag, fault dan parameter action parity`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** Do not
advertiseHuawei/FiberHomekeywritewithoutfixture. Unsupportedvendor
staysgenericread and extensibleprofile; createprofileevidenceticket ratherthan
guessedparameter.

---
