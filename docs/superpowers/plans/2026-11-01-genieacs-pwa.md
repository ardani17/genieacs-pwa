# GenieACS PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.
>
> Sesi ini hanya dokumentasi. Paket berstatus Planned; eksekusi hanya ketika
> prasyarat merged, desain ditinjau dan tiket pelaksanaan dipilih. Agen
> low-thinking mengambil satu paket/PR, bukan seluruh milestone sekaligus.

**Goal:** Menyediakan paket pelaksanaan kecil, rinci dan berurutan untuk
modernisasi dashboard GenieACS menjadi Next.js/PWA penuh Docker.

**Architecture:** Engine GenieACS tetap menjadi sumber pengelolaan perangkat dan
permission. Next.js BFF memanggil UI API native berizin; jalur dashboard
terpisah dari satu L2TP ACS, dengan observabilitas sejak fondasi.

**Tech Stack:** Node24.22.2, TypeScript5.9.3, Next16.4.3/React19.3.1,
Mongo8.0.34/driver7.8.0, Vector0.61.0/VictoriaLogs1.53.0. Versi adalah snapshot
riset1November2026; audit ulang merupakan gate, bukan izin upgrade major bebas.

## Global Constraints

- Sesi penyusunan ini hanya dokumen/rencana/Linear; tidak mengimplementasikan
  aplikasi, dependency atau runtime.
- Baca [kontrak](../../design/contracts.md) untuk API/auth/VPN/log/cache/UX dan
  [parity](../../design/feature-parity.md) saat menyentuh fungsi native.
- Baca [security upgrade](../../design/security-upgrade.md) saat mengubah
  dependency/image/tooling; blocker minimatch development masih memerlukan
  resolusi/review eksplisit.
- Baca [release policy](../../design/release-policy.md) saat mengubah
  versi/build/release: fork v1.2.N selalu patch+1, termasuk perombakan besar,
  tag immutable.
- Dashboard mobile first biru-putih; kapasitas10.000ONT/20operator,
  acuan4vCPU/8GiB/SSD, p95 list/filter≤2detik.
- Identitas/permission native, sesi absolut8jam; satu L2TP, profil gagal
  dipertahankan, auth failure pause; tanpa antrean otomatis perintah gagal.
- Cache persisten hanya aset generik/offline. Log terpusat14hari/10GB soft
  target, buffer1GiB, redaksi sebelum persist, aplikasi tetap hidup dengan
  logging degraded saat storage log gagal.
- Semua tes otomatis mengarah project `genieacs-pwa-check` dan database
  `genieacs_plan_test`; lab manual memakai perangkat/VPN uji yang ditetapkan.
  Folder referensi bukan target mutasi.

## Cara mengambil pekerjaan

1. Ambil **satu** subtask dari tabel, baca file milestone pada heading ID paket,
   kontrak yang disebut dan read set. Hindari memuat seluruh paket sekaligus.
2. Paket berstatus Planned sampai review desain selesai dan dependency merged.
   Cek setiap prasyarat. Status Backlog Linear bukan izin untuk melewati
   dependency; status Ready diberikan pelaksana/reviewer setelah gate terpenuhi.
3. Baca AGENTS.md, DEVELOPMENT.md dan status Git. Simpan perubahan pengguna yang
   tidak terkait. Pastikan origin fork, upstream push DISABLED dan branch
   development terbaru. Baseline source saat dokumen dibuat: development
   `564ce9f` (setup#1 dan policy#3 merged).
4. Buat branch **persis pada tabel** dari development. Satu paket satu PR.
   Jalankan baseline suite dulu; failure dependency/lingkungan dicatat, bukan
   dianggap tes red yang diharapkan.
5. Tulis test assertion dalam paket, lihat red yang dimaksud, lakukan langkah
   satu per satu, tes positif/negatif/log lalu pemeriksaan akhir.
6. Batas write set mencakup scripts/check-suites.json dan file paket. Perubahan
   schema/library/interface di luar kontrak dikembalikan untuk revisi rencana.
7. Kirim PR development; tiket In Review dengan bukti. Done setelah acceptance
   dan merge. Milestone selesai setelah semua child dan gate keseluruhan lulus.
   Rilis melalui PR development→main; workflow publikasi adalah langkah manual
   terpisah, bukan efek menyelesaikan subtask.

Contoh awal konkret untuk M01-A:

```sh
git status --short --branch
git remote -v
git fetch origin --prune --tags
git switch development
git pull --ff-only origin development
git switch -c chore/m01-a
docker compose -p genieacs-pwa-check -f compose.dev.yaml build tooling
docker compose -p genieacs-pwa-check -f compose.dev.yaml run --rm tooling npm ci --no-audit --no-fund
```

Expected: worktree hanya perubahan yang dipahami, branch chore/m01-a, tooling
project uji. Sebelum compose.test/runner dibuat, tes awal M01-A:

```sh
docker compose -p genieacs-pwa-check -f compose.dev.yaml run --rm tooling node --test scripts/security/inventory.test.mjs
```

Expected red: module inventory belum ada. Setelah file/helper tersedia, expected
PASS. Paket lainnya memakai command persis dalam dokumen masing-masing.

## Harness, command dan bukti

M01-A membuat `compose.test.yaml` minimal mongo+verify, CLI check dan suite map.
M01-C menambah tooling browser; M01-D menambah runtime/simulator. Semua berkas
runtime/skrip yang disebut pada rencana adalah target implementasi, belum
tersedia pada PR dokumen.

`scripts/check-suites.json`: map ID paket ke array object
`{cwd:string,command:string,args:string[]}`. CLI menjalankan spawn argv tanpa
shell, cwd harus di bawah repo, fail-fast exit nonzero. Setiap paket
mendaftarkan file tes pada write set-nya. Jika suite tidak ada/hasil wajib
hilang: `UNKNOWN_SUITE`/`MISSING_EVIDENCE`, bukan PASS kosong.

Root TS tests dibundel melalui `scripts/test-ts.mjs`: esbuild bundle platform
node/targetnode24/packagesexternal/formatcjs ke artifacts/tests, kemudian node
--test pada berkas hasil. Runner menolak input di luar repo. M01-A membuat
helper ini, menggunakan esbuild baseline yang sudah ada; M01-B memperbaruinya.
Frontend unit command `npm --prefix apps/web run test -- --run` dengan file tes
paket; API integration memakai actual listener+DB fixture test/helpers/app.ts
sesudah M02-A.

Sesudah stack test tersedia:

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml up -d --build
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs all
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm browser-tests npm run test:e2e
docker compose -p genieacs-pwa-check -f compose.test.yaml down
```

verify unit/API berada pada bridge test. browser-tests berbagi namespace **web
test** dan baseURL http://localhost:3000, sehingga PWA secure-context loopback
sah tanpa mematikan browser security. Ini hanya topologi test, bukan dashboard
berbagi namespace VPN. Browser image/Chromium mengikuti Playwright1.64.1 terpin;
dependency browser dipasang saat image build.

M02-A global setup membuat state admin/operator/restricted dari akun dummy
`Fixture-Only-2026!` pada DB uji. Akun dibuat dengan fungsi hash/salt native.
E2E yang sudah login menggunakan
`test.use({storageState: "../../artifacts/auth/operator.json"})` (admin memakai
admin.json), test login/ setup anonymous memakai state kosong. State auth dan
report diignore Git. Setiap test juga menguji penolakan API, bukan hanya menu
tersembunyi. compose.test menetapkan `PUBLIC_ORIGIN=http://localhost:3000` untuk
BFF browser.

Pemeriksaan akhir tiap PR:

```sh
git diff --check
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs all
```

Suite all menjalankan format check repo, lint root+web, tsc keduanya, unit/API
suite yang sudah terdaftar, build engine+web dan artifact assertion. E2E paket
yang terdampak dijalankan eksplisit; full E2E pada integrasi milestone/release.
CI mempertahankan job required `branch-policy` dan `verify`, menambah
release-sequence untuk release PR. Jangan mengganti pemeriksaan dengan exit0
jika report/artifact tidak tersedia.

Bukti: artifacts/tests, artifacts/ui, artifacts/security, artifacts/benchmark,
artifacts/failures hanya data sintetis. Log membuktikan request/operation
correlation, outcome/error dan secret-redaction. PR mencatat command/hasil,
screenshots viewport relevan dan keterbatasan lab. Artifact bukan source code
yang dikomit; metadata acceptance di docs/testing menyimpan path/hash/testID.

## Paket dan Linear

Parent M01–M09: ARD-155–ARD-163. Seluruh34subtask dibuat sebagai Backlog. Urutan
di bawah menjadi urutan pelaksanaan default; belum ada fitur dibangun.

| Paket | Subtask Linear                                                                                                                                                                          | Branch          | Rencana                                                                       |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------- |
| M01-A | [ARD-164 — Tooling, inventaris keamanan dan harness terisolasi](https://linear.app/ardani/issue/ARD-164/m01-a-tooling-inventaris-keamanan-dan-harness-terisolasi)                       | `chore/m01-a`   | [Keamanan, Docker, observabilitas](2026-11-01-genieacs-pwa/m01-foundation.md) |
| M01-B | [ARD-165 — Upgrade dependency backend dengan regresi driver/router](https://linear.app/ardani/issue/ARD-165/m01-b-upgrade-dependency-backend-dengan-regresi-driverrouter)               | `chore/m01-b`   | [Keamanan, Docker, observabilitas](2026-11-01-genieacs-pwa/m01-foundation.md) |
| M01-C | [ARD-166 — Scaffold frontend patched dan boundary kontrak](https://linear.app/ardani/issue/ARD-166/m01-c-scaffold-frontend-patched-dan-boundary-kontrak)                                | `feature/m01-c` | [Keamanan, Docker, observabilitas](2026-11-01-genieacs-pwa/m01-foundation.md) |
| M01-D | [ARD-167 — Runtime Docker dan fondasi L2TP terpisah dashboard](https://linear.app/ardani/issue/ARD-167/m01-d-runtime-docker-dan-fondasi-l2tp-terpisah-dashboard)                        | `feature/m01-d` | [Keamanan, Docker, observabilitas](2026-11-01-genieacs-pwa/m01-foundation.md) |
| M01-E | [ARD-168 — Logger JSON, redaksi dan availability saat storage gagal](https://linear.app/ardani/issue/ARD-168/m01-e-logger-json-redaksi-dan-availability-saat-storage-gagal)             | `feature/m01-e` | [Keamanan, Docker, observabilitas](2026-11-01-genieacs-pwa/m01-foundation.md) |
| M01-F | [ARD-169 — Vector, VictoriaLogs dan fault injection pipeline](https://linear.app/ardani/issue/ARD-169/m01-f-vector-victorialogs-dan-fault-injection-pipeline)                           | `feature/m01-f` | [Keamanan, Docker, observabilitas](2026-11-01-genieacs-pwa/m01-foundation.md) |
| M02-A | [ARD-170 — Session native delapan jam dan bootstrap JSON aman](https://linear.app/ardani/issue/ARD-170/m02-a-session-native-delapan-jam-dan-bootstrap-json-aman)                        | `feature/m02-a` | [Identitas dan API](2026-11-01-genieacs-pwa/m02-auth-api.md)                  |
| M02-B | [ARD-171 — Allowlist BFF resources, pagination, file stream dan error](https://linear.app/ardani/issue/ARD-171/m02-b-allowlist-bff-resources-pagination-file-stream-dan-error)          | `feature/m02-b` | [Identitas dan API](2026-11-01-genieacs-pwa/m02-auth-api.md)                  |
| M02-C | [ARD-172 — Permission VPN/log, log search aman dan audit endpoint](https://linear.app/ardani/issue/ARD-172/m02-c-permission-vpnlog-log-search-aman-dan-audit-endpoint)                  | `feature/m02-c` | [Identitas dan API](2026-11-01-genieacs-pwa/m02-auth-api.md)                  |
| M03-A | [ARD-173 — Token visual dan komponen aksesibel](https://linear.app/ardani/issue/ARD-173/m03-a-token-visual-dan-komponen-aksesibel)                                                      | `feature/m03-a` | [UI mobile](2026-11-01-genieacs-pwa/m03-mobile-ui.md)                         |
| M03-B | [ARD-174 — Navigasi mobile, login, setup dan akun](https://linear.app/ardani/issue/ARD-174/m03-b-navigasi-mobile-login-setup-dan-akun)                                                  | `feature/m03-b` | [UI mobile](2026-11-01-genieacs-pwa/m03-mobile-ui.md)                         |
| M03-C | [ARD-175 — Status koneksi dan error boundary yang dapat didiagnosis](https://linear.app/ardani/issue/ARD-175/m03-c-status-koneksi-dan-error-boundary-yang-dapat-didiagnosis)            | `feature/m03-c` | [UI mobile](2026-11-01-genieacs-pwa/m03-mobile-ui.md)                         |
| M04-A | [ARD-176 — Fixture aman, filter dan profil perangkat extensible](https://linear.app/ardani/issue/ARD-176/m04-a-fixture-aman-filter-dan-profil-perangkat-extensible)                     | `feature/m04-a` | [Baca dan diagnosis](2026-11-01-genieacs-pwa/m04-read-diagnostics.md)         |
| M04-B | [ARD-177 — Overview, daftar, filter, sort, pagination dan CSV](https://linear.app/ardani/issue/ARD-177/m04-b-overview-daftar-filter-sort-pagination-dan-csv)                            | `feature/m04-b` | [Baca dan diagnosis](2026-11-01-genieacs-pwa/m04-read-diagnostics.md)         |
| M04-C | [ARD-178 — Detail, parameter dan diagnosis baca berizin](https://linear.app/ardani/issue/ARD-178/m04-c-detail-parameter-dan-diagnosis-baca-berizin)                                     | `feature/m04-c` | [Baca dan diagnosis](2026-11-01-genieacs-pwa/m04-read-diagnostics.md)         |
| M05-A | [ARD-179 — Migrasi model WAN dan seluruh regresi firmware](https://linear.app/ardani/issue/ARD-179/m05-a-migrasi-model-wan-dan-seluruh-regresi-firmware)                                | `feature/m05-a` | [Task/WAN/WiFi](2026-11-01-genieacs-pwa/m05-device-operations.md)             |
| M05-B | [ARD-180 — Executor task native, idempotensi dan hasil akurat](https://linear.app/ardani/issue/ARD-180/m05-b-executor-task-native-idempotensi-dan-hasil-akurat)                         | `feature/m05-b` | [Task/WAN/WiFi](2026-11-01-genieacs-pwa/m05-device-operations.md)             |
| M05-C | [ARD-181 — Orkestrasi WAN bertahap dan pemulihan hasil parsial](https://linear.app/ardani/issue/ARD-181/m05-c-orkestrasi-wan-bertahap-dan-pemulihan-hasil-parsial)                      | `feature/m05-c` | [Task/WAN/WiFi](2026-11-01-genieacs-pwa/m05-device-operations.md)             |
| M05-D | [ARD-182 — Task staging, editor WAN dan operasi perangkat mobile](https://linear.app/ardani/issue/ARD-182/m05-d-task-staging-editor-wan-dan-operasi-perangkat-mobile)                   | `feature/m05-d` | [Task/WAN/WiFi](2026-11-01-genieacs-pwa/m05-device-operations.md)             |
| M05-E | [ARD-183 — WiFi, tag, fault dan parameter action parity](https://linear.app/ardani/issue/ARD-183/m05-e-wifi-tag-fault-dan-parameter-action-parity)                                      | `feature/m05-e` | [Task/WAN/WiFi](2026-11-01-genieacs-pwa/m05-device-operations.md)             |
| M06-A | [ARD-184 — Renderer React kompatibel seluruh config UI](https://linear.app/ardani/issue/ARD-184/m06-a-renderer-react-kompatibel-seluruh-config-ui)                                      | `feature/m06-a` | [Admin dan config](2026-11-01-genieacs-pwa/m06-admin-parity.md)               |
| M06-B | [ARD-185 — CRUD admin, editor script dan konfigurasi](https://linear.app/ardani/issue/ARD-185/m06-b-crud-admin-editor-script-dan-konfigurasi)                                           | `feature/m06-b` | [Admin dan config](2026-11-01-genieacs-pwa/m06-admin-parity.md)               |
| M06-C | [ARD-186 — User/permission, file firmware dan bootstrap aman](https://linear.app/ardani/issue/ARD-186/m06-c-userpermission-file-firmware-dan-bootstrap-aman)                            | `feature/m06-c` | [Admin dan config](2026-11-01-genieacs-pwa/m06-admin-parity.md)               |
| M07-A | [ARD-187 — Saved settings, enkripsi secret dan CAS revision](https://linear.app/ardani/issue/ARD-187/m07-a-saved-settings-enkripsi-secret-dan-cas-revision)                             | `feature/m07-a` | [VPN/log/ACS](2026-11-01-genieacs-pwa/m07-vpn-logs.md)                        |
| M07-B | [ARD-188 — Controller L2TP, retry terklasifikasi dan routing](https://linear.app/ardani/issue/ARD-188/m07-b-controller-l2tp-retry-terklasifikasi-dan-routing)                           | `feature/m07-b` | [VPN/log/ACS](2026-11-01-genieacs-pwa/m07-vpn-logs.md)                        |
| M07-C | [ARD-189 — UI VPN, diagnosis dan pencarian log terpusat](https://linear.app/ardani/issue/ARD-189/m07-c-ui-vpn-diagnosis-dan-pencarian-log-terpusat)                                     | `feature/m07-c` | [VPN/log/ACS](2026-11-01-genieacs-pwa/m07-vpn-logs.md)                        |
| M07-D | [ARD-190 — Extension alamat ACS dan provision tanpa secret default](https://linear.app/ardani/issue/ARD-190/m07-d-extension-alamat-acs-dan-provision-tanpa-secret-default)              | `feature/m07-d` | [VPN/log/ACS](2026-11-01-genieacs-pwa/m07-vpn-logs.md)                        |
| M08-A | [ARD-191 — Manifest, aset lokal dan mode instalasi](https://linear.app/ardani/issue/ARD-191/m08-a-manifest-aset-lokal-dan-mode-instalasi)                                               | `feature/m08-a` | [PWA](2026-11-01-genieacs-pwa/m08-pwa.md)                                     |
| M08-B | [ARD-192 — Service worker allowlist, offline icon dan update aman](https://linear.app/ardani/issue/ARD-192/m08-b-service-worker-allowlist-offline-icon-dan-update-aman)                 | `feature/m08-b` | [PWA](2026-11-01-genieacs-pwa/m08-pwa.md)                                     |
| M09-A | [ARD-193 — Benchmark 10.000 ONT dan failure matrix](https://linear.app/ardani/issue/ARD-193/m09-a-benchmark-10000-ont-dan-failure-matrix)                                               | `feature/m09-a` | [Kapasitas dan release](2026-11-01-genieacs-pwa/m09-validation-release.md)    |
| M09-B | [ARD-194 — Matriks parity akhir dan verifikasi perangkat uji](https://linear.app/ardani/issue/ARD-194/m09-b-matriks-parity-akhir-dan-verifikasi-perangkat-uji)                          | `feature/m09-b` | [Kapasitas dan release](2026-11-01-genieacs-pwa/m09-validation-release.md)    |
| M09-C | [ARD-195 — Runbook deployment, migrasi dan restore rehearsal](https://linear.app/ardani/issue/ARD-195/m09-c-runbook-deployment-migrasi-dan-restore-rehearsal)                           | `chore/m09-c`   | [Kapasitas dan release](2026-11-01-genieacs-pwa/m09-validation-release.md)    |
| M09-D | [ARD-196 — Penomoran release berurutan dan gate CI](https://linear.app/ardani/issue/ARD-196/m09-d-penomoran-release-berurutan-dan-gate-ci)                                              | `chore/m09-d`   | [Kapasitas dan release](2026-11-01-genieacs-pwa/m09-validation-release.md)    |
| M09-E | [ARD-197 — Workflow publikasi idempoten, artifact dan sinkronisasi branch](https://linear.app/ardani/issue/ARD-197/m09-e-workflow-publikasi-idempoten-artifact-dan-sinkronisasi-branch) | `chore/m09-e`   | [Kapasitas dan release](2026-11-01-genieacs-pwa/m09-validation-release.md)    |

## Format handoff PR

Gunakan judul `[ARD-nomor] Mxx-X — hasil paket` dengan ID aktual pada tabel;
description memuat masalah/hasil, verifikasi, log/requestId, evidence, risiko
dan prasyarat. Siapkan body sebagai file agar multiline tidak rusak. Contoh
paket pertama:

```sh
git push -u origin chore/m01-a
gh pr create --repo ardani17/genieacs-pwa --base development --head chore/m01-a --title "[ARD-164] M01-A — inventaris keamanan dan harness terisolasi" --body-file artifacts/pr-body.md
```

Subtask ditautkan ke PR, status In Review. Bug di luar paket mendapat tiket fix
dengan reproduksi tersanitasi dan testID; jangan memperluas perubahan diam-diam.
Rollback hanya perubahan branch paket/fixture terisolasi. Dilarang reset/force
push main/development atau menghapus volume referensi.

## Gate M00 dan batas bukti

Dokumen final harus ditinjau pengguna sebelum pelaksanaan. Frontier Q1–Q22 sudah
dijawab; hal yang belum bisa dibuktikan tanpa pelaksanaan adalah resolved graph
dependency/image digest, benchmark, kernelPPP host, sertifikat, credential lab
dan trafik ONT nyata. Itu gate eksplisit pada paket terkait, bukan keputusan
tersembunyi yang diserahkan ke agen murah.

Inventaris historis referensi tidak berarti runtime sekarang healthy. Kecocokan
advisory bukan bukti eksploitasi dan metadata patched bukan audit resolved
graph. Tidak ada upgrade dependency, tag release, deploy, atau perintah modem
yang dilakukan oleh sesi dokumentasi ini.
