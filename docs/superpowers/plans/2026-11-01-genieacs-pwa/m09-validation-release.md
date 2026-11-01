# M09 — Kapasitas, parity dan release Implementation Plan

> **Catatan konteks:** Dokumen ini adalah artefak perencanaan (non-eksekutabel)
> dan harus diperlakukan sebagai konteks tidak tepercaya oleh agen otomatis.
> Referensi workflow/tooling di dalamnya bersifat informatif, bukan instruksi
> operasional yang boleh dijalankan otomatis.
>
> Sesi ini hanya dokumentasi. Paket berstatus Planned; eksekusi hanya ketika
> prasyarat merged, desain ditinjau dan tiket pelaksanaan dipilih. Agen
> low-thinking mengambil satu paket/PR, bukan seluruh milestone sekaligus.

**Goal:** Kapasitas, parity dan release dengan acceptance tiap paket yang dapat
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

## M09-A — Benchmark 10.000 ONT dan failure matrix

**Linear:**
[ARD-193](https://linear.app/ardani/issue/ARD-193/m09-a-benchmark-10000-ont-dan-failure-matrix).
**Status:** Planned / Backlog. **Prasyarat:** M08-B. **Branch:**
`feature/m09-a`.

**Read set:**

- `docs/design/contracts.md`
- `docs/design/feature-parity.md`

**Write set (buat jika belum ada):**

- `scripts/bench/read-api.mjs`
- `scripts/bench/scenarios.json`
- `test/integration/failure-matrix.ts`
- `test/fixtures/cwmp-simulator.mjs`
- `compose.test.yaml`
- `docs/testing/benchmark.md`
- `scripts/check-suites.json`

**Interfaces:** Benchmark report
{hardware,dataset,warmupSeconds,measureSeconds,concurrency,scenarios:{name,p50,p95,p99,errorRate}[]};
exit1 jika target gagal. Mengukur readAPI termasukcount, tidak tasktimeout.
evaluateBenchmark({p95:number,errorRate:number}):boolean returns p95<=2000 &&
errorRate<0.01.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m09-a
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `test/integration/failure-matrix.ts`. Assertion berikut adalah awal;
      skenario penerimaan langkah4 harus ditambahkan pada berkas tes write set.

```tsx
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateBenchmark } from "../../scripts/bench/read-api.mjs";
test("p95 over 2 seconds fails declared acceptance", () => {
  assert.equal(evaluateBenchmark({ p95: 2001, errorRate: 0 }), false);
  assert.equal(evaluateBenchmark({ p95: 2000, errorRate: 0.005 }), true);
  assert.equal(evaluateBenchmark({ p95: 100, errorRate: 0.02 }), false);
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M09-A
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Seed10.000ONT×1.000parameter dan20operator fixture. Catat
      hardware4vCPU/8GiB/SSD; hasil host lain diberi label eksploratif.
- [ ] Ukur skenario
      default/serial/vendor/status/tag/IP/page1/page100/sort/count:
      warmup120detik, pengukuran600detik, concurrency20. Simpan raw samples,
      p50/p95/p99/errorrate dan explain; p95>2000ms atau error≥1% gagal.
- [ ] Catat CPU/RAM/Mongo index saat pengukuran. Perbaiki bottleneck dalam
      packet terarah, lalu ukur ulang skenario terdampak. Jangan memakai private
      DTO cache sebagai jalan pintas.
- [ ] Failure matrix mencakup backend/DB/VPN/auth/route/log
      storage/session/partial task/offline/update. Gunakan fake
      clock/sink/route, tanpa mengisi disk host atau mengubah referensi.
- [ ] Simulator CPE memakai transaksi Inform/get/set/fault/timeout sintetis pada
      CWMP test. Burst50Inform/detik diukur terpisah dari benchmark read API dan
      tidak menjadi janji kapasitas dari rata-rata.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M09-A reportallscenarios/p95/errors/hardware; failurematrix
expectedstatus/log/requestId/recovery verifies no successfalse/no
autoretry/noVPNdashboarddependency/no secret. Artifacts named
artifacts/benchmark and artifacts/failures. CI failurewhenmissingreport or
thresholdfail.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'scripts/bench/read-api.mjs' 'scripts/bench/scenarios.json' 'test/integration/failure-matrix.ts' 'test/fixtures/cwmp-simulator.mjs' 'compose.test.yaml' 'docs/testing/benchmark.md' 'scripts/check-suites.json'
git commit -m 'test(scale): benchmark device reads and exercise recovery paths'
git push -u origin feature/m09-a
```

Judul PR: `[ARD-193] M09-A — Benchmark 10.000 ONT dan failure matrix`; body-file
memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** Missingreferencehardware: saveexploratoryreport and
keepbenchmarkgateopen. Neverlowerthresholdorclaimsimulatorphysicaltestsuccess.
ProductionDB/ONTs not benchmarktarget.

---

## M09-B — Matriks parity akhir dan verifikasi perangkat uji

**Linear:**
[ARD-194](https://linear.app/ardani/issue/ARD-194/m09-b-matriks-parity-akhir-dan-verifikasi-perangkat-uji).
**Status:** Planned / Backlog. **Prasyarat:** M09-A. **Branch:**
`feature/m09-b`.

**Read set:**

- `docs/design/feature-parity.md`
- `docs/design/reference-wan-model.md`
- `docs/design/reference-wan-ui.md`
- `docs/design/contracts.md`

**Write set (buat jika belum ada):**

- `docs/testing/parity-evidence.json`
- `docs/testing/lab-checklist.md`
- `scripts/parity/check.mjs`
- `scripts/parity/check.test.mjs`
- `apps/web/e2e/full-parity.spec.ts`
- `scripts/check-suites.json`
- `docs/design/feature-parity.md`

**Interfaces:** Each parity row
{requirementId,packageId,testIds,automatedResult,labRequired,labResult,evidencePath};
missing/fail/requiredlabunverified blocksrelease.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m09-b
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `scripts/parity/check.test.mjs`. Assertion berikut adalah awal; skenario
      penerimaan langkah4 harus ditambahkan pada berkas tes write set.

```js
import test from "node:test";
import assert from "node:assert/strict";
import { assertParityComplete } from "./check.mjs";
test("unverified physical traffic is not a passed lab result", () => {
  assert.throws(
    () =>
      assertParityComplete([
        {
          requirementId: "WAN-BIND",
          testIds: ["wan-binding"],
          automatedResult: "pass",
          labRequired: true,
          labResult: "unverified",
          evidencePath: "artifacts/lab.json",
        },
      ]),
    /PARITY_INCOMPLETE/,
  );
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M09-B
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Beri requirementID stabil pada setiap row baseline/patch parity; petakan
      testID dan artifact aktual termasuk42assertion historis. Script menolak
      row/test/bukti yang hilang.
- [ ] Jalankan seluruh flow operator/admin/setup/file/config/task/diagnosis
      mobile/desktop dengan gate console/request errors serta filter/validator
      native.
- [ ] Lab khusus F670P3N19/P3N3/F609: backup konfigurasi, verifikasi jalur ACS,
      baca capability, create/edit/delete WAN nonmanajemen,
      VLAN/untagged/bridge/service/binding dan fresh read CWMP.
- [ ] Uji LAN/WiFi association, DHCP/IP dan trafik VLAN/SSID secara fisik,
      termasuk rename/Enable SSID. Catat model/firmware/tanggal/hasil tanpa
      secret dan pulihkan konfigurasi lab.
- [ ] Vendor/firmware tanpa bukti tetap unverified/generic read. Tambah profil
      melalui fixture+test tersendiri; hindari klaim dukungan tulis semua
      vendor.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M09-B parityscriptallrowslinked, automatedpass, labrequired evidenceactual. No
screenshot/HTTP200 substitutedforRPCortraffic. If labnotavailable reportblocked
verification, preserveplannedwork and no releaseReady.

Browser suite production test stack:

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm browser-tests npm run test:e2e -- e2e/full-parity.spec.ts
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
git add -- 'docs/testing/parity-evidence.json' 'docs/testing/lab-checklist.md' 'scripts/parity/check.mjs' 'scripts/parity/check.test.mjs' 'apps/web/e2e/full-parity.spec.ts' 'scripts/check-suites.json' 'docs/design/feature-parity.md'
git commit -m 'test(parity): verify full migration coverage and device lab evidence'
git push -u origin feature/m09-b
```

Judul PR: `[ARD-194] M09-B — Matriks parity akhir dan verifikasi perangkat uji`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** OnlydedicatedtestONT+authorizedlabVPN. If
activeACSmanagementpathriskorbackupmissing, stoplabmutation.
RestoretestONTfrombackupandverifyInform beforeclosinglabstep.

---

## M09-C — Runbook deployment, migrasi dan restore rehearsal

**Linear:**
[ARD-195](https://linear.app/ardani/issue/ARD-195/m09-c-runbook-deployment-migrasi-dan-restore-rehearsal).
**Status:** Planned / Backlog. **Prasyarat:** M09-B. **Branch:** `chore/m09-c`.

**Read set:**

- `docs/design/contracts.md`
- `docs/design/release-policy.md`

**Write set (buat jika belum ada):**

- `docs/deployment/linux.md`
- `docs/deployment/windows-wsl2.md`
- `docs/deployment/https.md`
- `docs/operations/backup-restore.md`
- `docs/operations/cutover-rollback.md`
- `scripts/backup.mjs`
- `scripts/restore.mjs`
- `test/backup-restore.ts`
- `.env.example`
- `scripts/check-suites.json`

**Interfaces:** backup manifest
{appVersion,upstreamVersion,schemaVersion,imageDigests,checksums,createdAt};
restore onlyexplicitnewproject+volume, keyrequired. Secretbundle encrypted and
excludedGit/artifacts. assertRestoreTarget({project:string,confirm:string}):void
accepts only explicit allowed target plus matching literal confirmation; default
none.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c chore/m09-c
```

- [ ] **2. Tambahkan tes perilaku pertama** pada `test/backup-restore.ts`.
      Assertion berikut adalah awal; skenario penerimaan langkah4 harus
      ditambahkan pada berkas tes write set.

```tsx
import test from "node:test";
import assert from "node:assert/strict";
import { assertRestoreTarget } from "../scripts/restore.mjs";
test("restore refuses reference or unspecified target", () => {
  assert.throws(
    () => assertRestoreTarget({ project: "genieacs", confirm: "" }),
    /UNSAFE_TARGET/,
  );
  assert.doesNotThrow(() =>
    assertRestoreTarget({
      project: "genieacs-pwa-restore-check",
      confirm: "RESTORE FIXTURE",
    }),
  );
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M09-C
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Runbook Linux/PowerShell menjelaskan clone/tag/digest, secrets, bootstrap,
      PPP/kernel, port firewall, HTTP web dan PWA HTTPS. Container permission
      dan path Windows/WSL ditulis eksplisit.
- [ ] Backup Mongo, settings, encryption key, service secrets, config dan image
      manifest. Arsip terenkripsi memakai recipient/keyfile admin, mempunyai
      checksum/versi, disimpan di luar Git/artifact publik.
- [ ] Restore rehearsal hanya project genieacs-pwa-restore-check dengan volume
      baru. Cocokkan user/config/file/settings/restart; key salah/corrupt/schema
      mismatch gagal sebelum target aktif berubah.
- [ ] Cutover membutuhkan backup, maintenance window, parallel stack port unik,
      bukti alamat ACS reachable, rencana DNS/IP ONT dan smoke. Admin memilih
      target/waktu; referensi tidak dihentikan otomatis.
- [ ] Rollback memakai image digest lama dan backup data yang sesuai migrasi.
      Alamat ACS/DNS rollback memerlukan jalur ONT reachable; bukan sekadar
      mengganti alias web.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M09-C cleanLinux+WSLdeploychecklist withhostPPPevidence,
fixturebackuprestorechecksum/secretkeyavailability, wrongtargetreject,
corruptarchivefail, no overwrittenexistingvolume. HTTPSfromphonecertificate
trustedmanualcheck included.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'docs/deployment/linux.md' 'docs/deployment/windows-wsl2.md' 'docs/deployment/https.md' 'docs/operations/backup-restore.md' 'docs/operations/cutover-rollback.md' 'scripts/backup.mjs' 'scripts/restore.mjs' 'test/backup-restore.ts' '.env.example' 'scripts/check-suites.json'
git commit -m 'docs(operations): add verified deployment backup and rollback procedures'
git push -u origin chore/m09-c
```

Judul PR: `[ARD-195] M09-C — Runbook deployment, migrasi dan restore rehearsal`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** No restore/delete without
explicitnamedtarget/project/confirmation. If host/usercert/realVPN/labmissing,
keepthatdeploymentgateopen and provideneededinputlist. Do notinvent credentials
or useexisting.env.

---

## M09-D — Penomoran release berurutan dan gate CI

**Linear:**
[ARD-196](https://linear.app/ardani/issue/ARD-196/m09-d-penomoran-release-berurutan-dan-gate-ci).
**Status:** Planned / Backlog. **Prasyarat:** M09-C. **Branch:** `chore/m09-d`.

**Read set:**

- `docs/design/release-policy.md`
- `package.json`
- `npm-shrinkwrap.json`
- `apps/web/package.json`
- `build/build.ts`
- `SECURITY.md`

**Write set (buat jika belum ada):**

- `scripts/release/version.mjs`
- `scripts/release/version.test.mjs`
- `scripts/release/prepare.mjs`
- `release/upstream.json`
- `package.json`
- `npm-shrinkwrap.json`
- `apps/web/package.json`
- `apps/web/package-lock.json`
- `build/build.ts`
- `CHANGELOG.md`
- `SECURITY.md`
- `.github/workflows/ci.yml`
- `docs/DEVELOPMENT.md`
- `scripts/check-suites.json`

**Interfaces:** nextForkVersion(tags:string[]):string;
assertReleaseVersion(tags,candidate):void;
assertManifestVersions(root,shrinkwrap,web,weblock):void. Sequence v1.2.N
exact+1; upstream separate.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c chore/m09-d
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `scripts/release/version.test.mjs`. Assertion berikut adalah awal;
      skenario penerimaan langkah4 harus ditambahkan pada berkas tes write set.

```js
import test from "node:test";
import assert from "node:assert/strict";
import { nextForkVersion, assertReleaseVersion } from "./version.mjs";
test("release sequence remains consecutive despite major redesign", () => {
  assert.equal(nextForkVersion(["v1.2.9", "v1.2.15", "v1.2.16"]), "1.2.17");
  assert.equal(nextForkVersion(["v1.2.99", "v1.3.0"]), "1.2.100");
  assert.throws(
    () => assertReleaseVersion(["v1.2.16"], "1.2.18"),
    /SKIPPED_RELEASE_VERSION/,
  );
  assert.throws(
    () => assertReleaseVersion(["v1.2.16"], "2.0.0"),
    /INVALID_RELEASE_LINE/,
  );
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M09-D
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Parse tag origin pola v1.2.N stabil dengan BigInt patch; max+1, tanpa sort
      lexical atau aturan major/minor otomatis.
- [ ] Sumber versi wajib remote `git ls-remote --tags --refs origin`, bukan
      semua tag lokal. Upstream disimpan sebagai upstream/vX.Y.Z agar tag dengan
      nomor sama dapat berbeda commit. Tes upstream/v1.2.99 tidak mengubah next
      fork1.2.17 setelah origin v1.2.16.
- [ ] prepare.mjs memeriksa worktree bersih/development ancestry, fetch tag
      read-only, memperbarui manifest/lock root+web dan changelog. Tidak membuat
      tag/push; build gagal sebelum tag tidak mengonsumsi nomor.
- [ ] release/upstream.json menyimpan tag/commit engine penuh. Import upstream
      hanya memperbarui baseline terpisah, sementara versi fork tetap next
      patch.
- [ ] RELEASE_VERSION harus sama manifest; artifact release persis tag,
      development boleh +metadata. OCI/diagnosis mencatat
      fork/upstream/commit/schema.
- [ ] CI release-sequence khusus PR development→main memeriksa next version,
      konsistensi manifest/changelog/migration. PR fitur biasa tidak menaikkan
      versi.
- [ ] Perbarui SECURITY untuk latest stable fork dan DEVELOPMENT untuk kebijakan
      baru. Breaking changes wajib migration/backup/rollback meskipun nomor
      patch.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

Tes policy table lengkap:16→17, loncat18 ditolak,1.3/2 ditolak,99→100, leading
zero, upstream tag terpisah, manifest mismatch, existing tag mengonsumsi nomor.
Dry-run prepare memakai fixture Git remote. Nomor aktual dihitung saat
pelaksanaan; jangan memaksa17 bila17 sudah ada.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'scripts/release/version.mjs' 'scripts/release/version.test.mjs' 'scripts/release/prepare.mjs' 'release/upstream.json' 'package.json' 'npm-shrinkwrap.json' 'apps/web/package.json' 'apps/web/package-lock.json' 'build/build.ts' 'CHANGELOG.md' 'SECURITY.md' '.github/workflows/ci.yml' 'docs/DEVELOPMENT.md' 'scripts/check-suites.json'
git commit -m 'feat(release): enforce consecutive fork release versions'
git push -u origin chore/m09-d
```

Judul PR: `[ARD-196] M09-D — Penomoran release berurutan dan gate CI`; body-file
memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** Remote tagconflict/newrelease race means
stopandrefreshcandidate; neverreset/deleteexistingtag.
Thispacketaddsvalidationonly; doesnotpublishreleaseor mergePR.

---

## M09-E — Workflow publikasi idempoten, artifact dan sinkronisasi branch

**Linear:**
[ARD-197](https://linear.app/ardani/issue/ARD-197/m09-e-workflow-publikasi-idempoten-artifact-dan-sinkronisasi-branch).
**Status:** Planned / Backlog. **Prasyarat:** M09-D. **Branch:** `chore/m09-e`.

**Read set:**

- `docs/design/release-policy.md`
- `docs/testing/parity-evidence.json`
- `docs/operations/cutover-rollback.md`

**Write set (buat jika belum ada):**

- `.github/workflows/release.yml`
- `scripts/release/publish.mjs`
- `scripts/release/publish.test.mjs`
- `scripts/release/verify-artifacts.mjs`
- `docs/operations/releasing.md`
- `scripts/check-suites.json`

**Interfaces:**
publishRelease({version,commit,checksums},adapter):created|resumed;
adapter.getTag/createTag/createOrUpdateRelease/pushImages testfakes.
Humanmanualworkflowonly, main+checksrequired.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c chore/m09-e
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `scripts/release/publish.test.mjs`. Assertion berikut adalah awal;
      skenario penerimaan langkah4 harus ditambahkan pada berkas tes write set.

```js
import test from "node:test";
import assert from "node:assert/strict";
import { publishRelease } from "./publish.mjs";
test("failed upload resumes same immutable tag and commit", async () => {
  const commit = "c".repeat(40);
  const refs = new Map([["v1.2.17", commit]]);
  const created = [];
  const r = await publishRelease(
    { version: "1.2.17", commit, checksums: { "sbom.json": "a".repeat(64) } },
    {
      getTag: async (t) => refs.get(t),
      createTag: async (t) => {
        created.push(t);
      },
      uploadAssets: async () => {},
      verifyExistingAssets: async () => true,
      createOrUpdateRelease: async () => {},
    },
  );
  assert.equal(r, "resumed");
  assert.deepEqual(created, []);
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M09-E
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Workflow manual hanya main dengan required CI/parity/security sukses;
      concurrency release-genieacs-pwa dan cancel-in-progress:false. Publish job
      memakai permission minimum yang dibutuhkan.
- [ ] Bangun engine/web/vpn image versi exact, periksa
      artifact/SBOM/checksum/scan/smoke sebelum tag. amd64 target awal; platform
      lain tidak diberi klaim tanpa uji.
- [ ] Fetch ulang tag pada batas publish; kandidat harus next atau resume tag
      persis dengan commit/checksum sama. Atomic annotated tag create; conflict
      berhenti tanpa force.
- [ ] Publikasi GHCR versi/digest dan GitHub Release berisi
      changelog/upstream/migration/SBOM. latest alias setelah smoke; upload
      gagal dilanjutkan pada tag sama dan asset checksum diverifikasi.
- [ ] Buka PR main→development untuk sinkronisasi dan tautkan bukti ke Linear.
      Done hanya setelah workflow publikasi nyata dan acceptance; dry run tidak
      dinyatakan release.
- [ ] Dokumentasikan rollback image/data. Rilis perbaikan selalu nomor
      berikutnya; sejarah tag/release yang sudah terbit dipertahankan.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M09-E fakeadapter
newtagcreate,uploadfailure/resume,samecommitdifferentchecksumconflict,concurrenttagrace,wrongbranch/checkfailure/noparity/securityfail.
DryrunagainstfixtureGitHubadapteronly. Releaseworkflowmanual
remainsuntriggereduntilhumanreleaseaction.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- '.github/workflows/release.yml' 'scripts/release/publish.mjs' 'scripts/release/publish.test.mjs' 'scripts/release/verify-artifacts.mjs' 'docs/operations/releasing.md' 'scripts/check-suites.json'
git commit -m 'ci(release): publish verified immutable sequential releases'
git push -u origin chore/m09-e
```

Judul PR:
`[ARD-197] M09-E — Workflow publikasi idempoten, artifact dan sinkronisasi branch`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** CI/actionpermissionfailure or
automaticapprovalrejection=>stoppublicationandsummarizeaction/reason.
Neverreusepublishedtagwithdifferentcommit, skipnumberforuploadretryor
bypassmainprotection.

---
