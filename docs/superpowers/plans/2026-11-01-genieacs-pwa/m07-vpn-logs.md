# M07 — VPN, log dan alamat ACS Implementation Plan

> **Catatan proses (informasional):** Dokumen ini mencatat alur kerja yang
> _umumnya_ memakai superpowers:subagent-driven-development (disarankan) atau
> superpowers:executing-plans untuk implementasi bertahap. Checklist tetap
> memakai sintaks checkbox (`- [ ]`) untuk pelacakan. Bukan instruksi eksekusi
> otomatis untuk agent/tool tanpa kebijakan allowlist dan konfirmasi.
>
> Sesi ini hanya dokumentasi. Paket berstatus Planned; eksekusi hanya ketika
> prasyarat merged, desain ditinjau dan tiket pelaksanaan dipilih. Agen
> low-thinking mengambil satu paket/PR, bukan seluruh milestone sekaligus.

**Goal:** VPN, log dan alamat ACS dengan acceptance tiap paket yang dapat
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

## M07-A — Saved settings, enkripsi secret dan CAS revision

**Linear:**
[ARD-187](https://linear.app/ardani/issue/ARD-187/m07-a-saved-settings-enkripsi-secret-dan-cas-revision).
**Status:** Planned / Backlog. **Prasyarat:** M06-C. **Branch:**
`feature/m07-a`.

**Read set:**

- `docs/design/contracts.md`
- `docs/adr/0009-konfigurasi-vpn-persisten-tanpa-rollback-otomatis.md`

**Write set (buat jika belum ada):**

- `lib/ui/app-settings.ts`
- `lib/ui/app-api.ts`
- `test/app-settings.ts`
- `test/settings-permissions.ts`
- `packages/app-contracts/src/settings.ts`
- `apps/web/src/app/api/app/settings/route.ts`
- `docker/bootstrap-secrets.mjs`
- `compose.yaml`
- `compose.test.yaml`
- `scripts/check-suites.json`

**Interfaces:** getSettings(ctx):VpnProfileView;
updateSettings(ctx,input):{desiredRevision,applyState};
bootstrapSettings(env):create-if-missing;
resetBootstrap(ctx,revision,'RESET'):result. AES256GCM secretbox
{iv,ciphertext,tag,keyId}.
encryptSecret(secret:string,key:Buffer):{iv:string,ciphertext:string,tag:string,keyId:string};
decryptSecret(box,key:Buffer):string.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m07-a
```

- [ ] **2. Tambahkan tes perilaku pertama** pada `test/app-settings.ts`.
      Assertion berikut adalah awal; skenario penerimaan langkah4 harus
      ditambahkan pada berkas tes write set.

```tsx
import test from "node:test";
import assert from "node:assert/strict";
import { encryptSecret, decryptSecret } from "../lib/ui/app-settings.ts";
test("secret ciphertext authenticates data and wrong key fails", () => {
  const key = Buffer.alloc(32, 1),
    wrong = Buffer.alloc(32, 2);
  const box = encryptSecret("fixture-vpn-password", key);
  assert.equal(JSON.stringify(box).includes("fixture-vpn-password"), false);
  assert.equal(decryptSecret(box, key), "fixture-vpn-password");
  assert.throws(() => decryptSecret(box, wrong), /STORAGE_ERROR/);
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M07-A
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Buat singleton app_settings schema1 dan CAS revision. Bootstrap .env hanya
      ketika document belum ada; sesudahnya nilai tersimpan menjadi utama saat
      restart.
- [ ] Buat key AES256GCM32byte dan service bearer token pada directory secrets
      yang diignore Git. Mount read-only ke service yang perlu; key tidak dibuat
      ulang jika ciphertext sudah ada.
- [ ] Validasi DTO strict server/user/newline/NUL/routes≤32/MTU/ACS
      IP-DNS-autoPPP. passwordAction keep/replace, readback hanya
      passwordConfigured.
- [ ] PUT memeriksa vpn3/filter/validator/origin/revision; update Mongo atomik
      menaikkan revision1. Stale409 tidak apply. Persist dahulu, apply gagal
      tetap mempertahankan desired profile baru.
- [ ] Endpoint internal agent mengirim decrypted profile hanya dengan controller
      token. Endpoint ACS address memakai token berbeda dan hanya mengembalikan
      alamat. Browser/BFF tidak mem-proxy endpoint internal.
- [ ] Reset bootstrap memerlukan RESET+revision. Kandidat divalidasi sebelum
      CAS; gagal tetap mempertahankan profil tersimpan. Audit hanya field
      names/revision/actor/requestId.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

Saved UI settings bertahan setelah restart/env berubah; bootstrap sekali,
keep/replace, CAS race satu pemenang, wrong key tanpa overwrite, operator403,
tag GCM rusak, service token terisolasi. Apply gagal mempertahankan
desiredRevision dan error terlihat.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'lib/ui/app-settings.ts' 'lib/ui/app-api.ts' 'test/app-settings.ts' 'test/settings-permissions.ts' 'packages/app-contracts/src/settings.ts' 'apps/web/src/app/api/app/settings/route.ts' 'docker/bootstrap-secrets.mjs' 'compose.yaml' 'compose.test.yaml' 'scripts/check-suites.json'
git commit -m 'feat(settings): persist VPN and ACS configuration with revision control'
git push -u origin feature/m07-a
```

Judul PR: `[ARD-187] M07-A — Saved settings, enkripsi secret dan CAS revision`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** Missingkey/configinvalid: stopapply and
surfacederror; do not fallbackenv or delete app_settings. Backupkey withdatabase
mandatory in M09. Database/encryptiontests only fixture.

---

## M07-B — Controller L2TP, retry terklasifikasi dan routing

**Linear:**
[ARD-188](https://linear.app/ardani/issue/ARD-188/m07-b-controller-l2tp-retry-terklasifikasi-dan-routing).
**Status:** Planned / Backlog. **Prasyarat:** M07-A. **Branch:**
`feature/m07-b`.

**Read set:**

- `docs/design/contracts.md`
- `docker/vpn/entrypoint.sh`
- `scripts/preflight.mjs`

**Write set (buat jika belum ada):**

- `services/vpn-controller/src/server.ts`
- `services/vpn-controller/src/state.ts`
- `services/vpn-controller/src/profile.ts`
- `services/vpn-controller/src/routes.ts`
- `services/vpn-controller/src/ppp-events.ts`
- `services/vpn-controller/test/state.test.ts`
- `services/vpn-controller/test/routes.test.ts`
- `docker/vpn/Dockerfile`
- `docker/vpn/entrypoint.sh`
- `compose.test.yaml`
- `scripts/check-suites.json`

**Interfaces:** VpnStatus/VpnState exactcontracts;
transition(state,event,clock,rng):{state,effects}; effects
spawnfixedargv/installOwnedRoutes/scheduleRetry only.
GETstatus/PUTprofile/reconnect/diagnose internal strict.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m07-b
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `services/vpn-controller/test/state.test.ts`. Assertion berikut adalah
      awal; skenario penerimaan langkah4 harus ditambahkan pada berkas tes write
      set.

```tsx
import test from "node:test";
import assert from "node:assert/strict";
import { transition } from "../src/state.ts";
test("auth rejection pauses retry and never rolls back profile", () => {
  const r = transition(
    { state: "connecting", desiredRevision: 4, attempt: 1 },
    { type: "auth_rejected" },
    () => 0,
    () => 0,
  );
  assert.equal(r.state.state, "auth_failed");
  assert.equal(r.state.desiredRevision, 4);
  assert.equal(
    r.effects.some((x) => x.type === "schedule_retry"),
    false,
  );
  assert.equal(
    r.effects.some((x) => String(x.type) === "rollback_profile"),
    false,
  );
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M07-B
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Implementasikan pure state machine VpnState. Startup mengambil desired
      profile dari native internal endpoint; backend belum siap memicu retry
      load10detik tanpa mematikan dashboard.
- [ ] Render xl2tpd/pppd dengan input tervalidasi, file0600 dan atomic rename.
      spawn fixed argv tanpa shell. Satu connect process, timeout60detik,
      duplicate reconnect409.
- [ ] Auth rejection exit19/PAP/CHAP failed menjadi auth_failed tanpa timer.
      Transient memakai10/20/40/60detik+jitter0–20%. Connected60detik reset
      attempt; manual reconnect/revisi profil membuka pause.
- [ ] Routes IPv4≤32; tolak default/overlap Docker/ingress/duplikat. Resolve
      endpoint VPN lewat host egress sebelum route. Hanya route milik
      instalasi/revisi yang boleh dihapus.
- [ ] PUT profile menerima secret hanya internal, revision monotonic dan
      response tanpa password. desired/applied revision terpisah; profil lama
      tidak diaktifkan otomatis saat profil baru gagal.
- [ ] Tes otomatis memakai FakePppProcess/clock/argv stub; lab Linux/WSL
      mengecek kernel/PPP sebenarnya. NET_ADMIN minimum, tanpa privileged/Docker
      socket.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

Fake clock membuktikan backoff/jitter/auth pause/manual reconnect dan tidak ada
auto-revert. Route milik sendiri dibersihkan; default/overlap/injection ditolak.
Web tetap200 semua state, log tanpa credential. PPP nyata tetap gate lab
terpisah.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'services/vpn-controller/src/server.ts' 'services/vpn-controller/src/state.ts' 'services/vpn-controller/src/profile.ts' 'services/vpn-controller/src/routes.ts' 'services/vpn-controller/src/ppp-events.ts' 'services/vpn-controller/test/state.test.ts' 'services/vpn-controller/test/routes.test.ts' 'docker/vpn/Dockerfile' 'docker/vpn/entrypoint.sh' 'compose.test.yaml' 'scripts/check-suites.json'
git commit -m 'feat(vpn): control L2TP with explicit retry and routing states'
git push -u origin feature/m07-b
```

Judul PR: `[ARD-188] M07-B — Controller L2TP, retry terklasifikasi dan routing`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** If kernelunsupported, host_unsupportedandno
redialloop. Do not globallyflush routes or enablefulltunnel.
LiveVPNtestrequiresdedicatedtestendpointcredentials, not reference .env.

---

## M07-C — UI VPN, diagnosis dan pencarian log terpusat

**Linear:**
[ARD-189](https://linear.app/ardani/issue/ARD-189/m07-c-ui-vpn-diagnosis-dan-pencarian-log-terpusat).
**Status:** Planned / Backlog. **Prasyarat:** M07-B. **Branch:**
`feature/m07-c`.

**Read set:**

- `docs/design/contracts.md`
- `apps/web/src/server/resource-adapter.ts`

**Write set (buat jika belum ada):**

- `apps/web/src/app/(dashboard)/settings/vpn/page.tsx`
- `apps/web/src/app/(dashboard)/diagnostics/logs/page.tsx`
- `apps/web/src/features/vpn/profile-form.tsx`
- `apps/web/src/features/vpn/status-panel.tsx`
- `apps/web/src/features/logs/log-search.tsx`
- `apps/web/src/app/api/app/vpn/reconnect/route.ts`
- `apps/web/src/app/api/app/vpn/diagnose/route.ts`
- `apps/web/src/app/api/app/vpn/reset-bootstrap/route.ts`
- `apps/web/e2e/vpn-logs.spec.ts`
- `scripts/check-suites.json`

**Interfaces:** VPNform VpnProfileInput/View, statuspoll15s, CASconflict reload;
LogSearch filters boundedDTO fromM02-C, requestId link drilldown internal
sameorigin.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m07-c
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `apps/web/e2e/vpn-logs.spec.ts`. Assertion berikut adalah awal; skenario
      penerimaan langkah4 harus ditambahkan pada berkas tes write set.

```tsx
import { test, expect } from "@playwright/test";
test("failed new profile stays visible and dashboard stays usable", async ({
  page,
}) => {
  await page.goto("/settings/vpn");
  await page.getByLabel("Server VPN").fill("vpn-fail.example.invalid");
  await page
    .getByRole("button", { name: "Simpan profil", exact: true })
    .click();
  await expect(page.getByText(/Profil tersimpan.*koneksi gagal/)).toBeVisible();
  await expect(page.getByLabel("Server VPN")).toHaveValue(
    "vpn-fail.example.invalid",
  );
  await page
    .getByRole("link", { name: "Perangkat", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/devices/);
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm browser-tests npm run test:e2e -- e2e/vpn-logs.spec.ts
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Form server/user/password keep-replace/routes/MTU/ACS mode menampilkan
      dampak save. Auth gagal menjelaskan retry pause dan reconnect; tidak ada
      countdown rollback profil.
- [ ] Status memisahkan desired/applied revision, PPP/IP/route, dashboard, ACS
      resolve dan waktu probe. Operator hanya status/diagnosis berizin;
      edit/reconnect memerlukan vpn3.
- [ ] Reset bootstrap memerlukan RESET+current revision. CAS409 mempertahankan
      form lokal dan meminta reload/compare; tidak melakukan forced save
      otomatis.
- [ ] Logs UI default15menit, filter bounded, page100, detail JSON redacted,
      drilldown requestId dan export logs3. Tampilkan
      retensi14hari/target10GB/buffer1GiB serta status degraded.
- [ ] Sink down menampilkan503/retry baca; tetap izinkan koreksi VPN. Operator
      mendapat requestId untuk pelaporan tanpa link global log yang tidak
      berizin.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

Admin/operator diuji melalui UI dan API langsung. VPN down+web up, auth pause,
profil baru tetap tersimpan, reconnect/reset/CAS, log query
bounded/escape/export cap/sink outage, mobile dan requestId drilldown. Secret
tidak terlihat di view/log/cache.

Expected browser: viewport relevan PASS, screenshot/report tersedia, console
error tak terduga gagal. Gunakan `../../artifacts/auth/admin.json` untuk admin,
operator.json untuk operator dan state kosong untuk anonymous; helper M02-A
membuatnya dari akun dummy. Path relatif cwd apps/web.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'apps/web/src/app/(dashboard)/settings/vpn/page.tsx' 'apps/web/src/app/(dashboard)/diagnostics/logs/page.tsx' 'apps/web/src/features/vpn/profile-form.tsx' 'apps/web/src/features/vpn/status-panel.tsx' 'apps/web/src/features/logs/log-search.tsx' 'apps/web/src/app/api/app/vpn/reconnect/route.ts' 'apps/web/src/app/api/app/vpn/diagnose/route.ts' 'apps/web/src/app/api/app/vpn/reset-bootstrap/route.ts' 'apps/web/e2e/vpn-logs.spec.ts' 'scripts/check-suites.json'
git commit -m 'feat(operations): add VPN management and integrated log diagnostics'
git push -u origin feature/m07-c
```

Judul PR: `[ARD-189] M07-C — UI VPN, diagnosis dan pencarian log terpusat`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** Do not connect to realVPNbyUItest; simulator states
configuredtestonly. Error recoverybuttons never
exposeprivilegedshellcommandorservice token.

---

## M07-D — Extension alamat ACS dan provision tanpa secret default

**Linear:**
[ARD-190](https://linear.app/ardani/issue/ARD-190/m07-d-extension-alamat-acs-dan-provision-tanpa-secret-default).
**Status:** Planned / Backlog. **Prasyarat:** M07-C. **Branch:**
`feature/m07-d`.

**Read set:**

- `docs/design/contracts.md`
- `docs/design/feature-parity.md`

**Write set (buat jika belum ada):**

- `config/ext/acs-config.js`
- `config/provisions/inform.js`
- `test/acs-address.ts`
- `test/inform-provision.ts`
- `lib/ui/app-api.ts`
- `docker/engine/Dockerfile`
- `compose.yaml`
- `docs/deployment/acs-address.md`
- `scripts/check-suites.json`

**Interfaces:** getAcsUrl(args,callback) extensionnative; fetchaddressonly
fromsavedsettings via scopedtoken, autoPPP resolvedlocally. Provision uses
ext('acs-config','getAcsUrl'), capabilitiesrootTR098/TR181,
secretsinputexternal.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m07-d
```

- [ ] **2. Tambahkan tes perilaku pertama** pada `test/acs-address.ts`.
      Assertion berikut adalah awal; skenario penerimaan langkah4 harus
      ditambahkan pada berkas tes write set.

```tsx
import test from "node:test";
import assert from "node:assert/strict";
import { formatAcsUrl } from "../packages/app-contracts/src/settings.ts";
test("manual DNS and IPv6 addresses remain distinct from dashboard", () => {
  assert.equal(
    formatAcsUrl({
      mode: "manual",
      scheme: "http",
      host: "acs.example.invalid",
      port: 7547,
      path: "/",
    }),
    "http://acs.example.invalid:7547/",
  );
  assert.equal(
    formatAcsUrl({
      mode: "manual",
      scheme: "https",
      host: "2001:db8::1",
      port: 7547,
      path: "/cwmp",
    }),
    "https://[2001:db8::1]:7547/cwmp",
  );
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M07-D
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] formatAcsUrl memakai URL API dengan scheme/host/port/path tervalidasi.
      IP/DNS manual tidak berubah saat PPP berubah; autoPPP tanpa IPv4
      menghasilkan error.
- [ ] Extension mengambil address-only settings melalui scoped token,
      timeout2detik dan memory cache≤5detik. Callback dipanggil sekali; read
      failure tidak fallback .env yang sudah dikalahkan persisted settings.
- [ ] Provision memilih TR098/TR181 dari capability parameter aktual, bukan
      brand. Pertahankan ext dua argumen, URL/CR/PeriodicInform; default200detik
      hanya bootstrap parity dan dapat dikonfigurasi.
- [ ] CR credential berasal dari deployment secrets, bukan nilai referensi. Seed
      tidak menimpa existing provision dan useradmin tetap disabled.
- [ ] Save alamat tidak bulk push ke ONT. Reprovision dipilih eksplisit melalui
      task berizin dengan preview risiko; DNS provider/certificate/ONT
      reachability diterangkan di runbook.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M07-D IP/DNS/IPv6/autoPPP/noPPP/invalidURL/sourcefail; extensioncallbackonce;
provisionTR098/TR181only/capabilitymissingerror; no literalrealcredentials.
SimulatedInformreads savedUIURLafterrestart/envchanged; CWMPsession
addressverifiedliveM09.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'config/ext/acs-config.js' 'config/provisions/inform.js' 'test/acs-address.ts' 'test/inform-provision.ts' 'lib/ui/app-api.ts' 'docker/engine/Dockerfile' 'compose.yaml' 'docs/deployment/acs-address.md' 'scripts/check-suites.json'
git commit -m 'feat(acs): support persistent IP and DNS address configuration'
git push -u origin feature/m07-d
```

Judul PR:
`[ARD-190] M07-D — Extension alamat ACS dan provision tanpa secret default`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** If ONT cannot reachnewURL, do not bulk
pushunverifiedaddress. Planning/testing usesexample.invalid/docIP,
usermustsupplylabreachableACS endpointbeforecutover.

---
