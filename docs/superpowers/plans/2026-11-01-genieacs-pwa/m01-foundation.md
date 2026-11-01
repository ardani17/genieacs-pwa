# M01 — Keamanan, Docker dan observabilitas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.
>
> Sesi ini hanya dokumentasi. Paket berstatus Planned; eksekusi hanya ketika
> prasyarat merged, desain ditinjau dan tiket pelaksanaan dipilih. Agen
> low-thinking mengambil satu paket/PR, bukan seluruh milestone sekaligus.

**Goal:** Keamanan, Docker dan observabilitas dengan acceptance tiap paket yang
dapat ditinjau mandiri.

**Architecture:** Engine GenieACS dan Next.js dibangun terpisah, dengan jaringan
dashboard independen VPN. Logger/collector tersedia sebelum fitur operasional
bertambah.

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

## M01-A — Tooling, inventaris keamanan dan harness terisolasi

**Linear:**
[ARD-164](https://linear.app/ardani/issue/ARD-164/m01-a-tooling-inventaris-keamanan-dan-harness-terisolasi).
**Status:** Planned / Backlog. **Prasyarat:** ARD-153 review; ARD-152 merged.
**Branch:** `chore/m01-a`.

**Read set:**

- `AGENTS.md`
- `docs/DEVELOPMENT.md`
- `docs/design/security-upgrade.md`
- `package.json`
- `npm-shrinkwrap.json`
- `.github/workflows/ci.yml`

**Write set (buat jika belum ada):**

- `docker/development/Dockerfile`
- `compose.test.yaml`
- `scripts/check.mjs`
- `scripts/check-suites.json`
- `scripts/security/inventory.mjs`
- `scripts/security/inventory.test.mjs`
- `docs/testing/README.md`
- `.github/workflows/dependency-security.yml`
- `.github/dependabot.yml`
- `.gitignore`
- `scripts/test-ts.mjs`

**Interfaces:** Menghasilkan CLI node scripts/check.mjs <package-id|all>, exit0
hanya bila semua child command sukses. inventory(lock):
{name,version,dev,optional,path}[]; menerima shrinkwrap v2/v3 dan package-lock
v3. compose.test: project genieacs-pwa-check, mongo auth fixture, verify
Node24.22.2, volumes khusus project.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c chore/m01-a
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `scripts/security/inventory.test.mjs`. Assertion berikut adalah awal;
      skenario penerimaan langkah4 harus ditambahkan pada berkas tes write set.

```js
import test from "node:test";
import assert from "node:assert/strict";
import { inventory } from "./inventory.mjs";
test("keeps distinct transitive paths in shrinkwrap v2", () => {
  const rows = inventory({
    lockfileVersion: 2,
    packages: {
      "": { name: "root", version: "1.2.16" },
      "node_modules/qs": { version: "6.15.0" },
      "node_modules/a/node_modules/qs": { version: "6.17.1", dev: true },
    },
  });
  assert.equal(rows.filter((x) => x.name === "qs").length, 2);
  assert.equal(rows.find((x) => x.path.includes("/a/")).dev, true);
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M01-A
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia. Sebelum compose.test/runner tersedia, jalankan
`node --test scripts/security/inventory.test.mjs` melalui tooling compose.dev
sesuai indeks; expected awal missing module inventory, lalu PASS sesudah helper
dibuat.

**Urutan perubahan:**

- [ ] Pin Node24.22.2 bookworm-slim: docker buildx imagetools inspect
      node:24.22.2-bookworm-slim; catat manifest digest yang benar ke Dockerfile
      dan inventory, jangan menebak digest.
- [ ] Buat compose.test.yaml (name genieacs-pwa-check): mongo8.0.34 dengan
      user/password dummy fixture, health mongosh ping; verify memakai
      Dockerfile tooling, bind repo /workspace, volume verify_modules dan
      npm_cache, env MONGO_URL ke database genieacs_plan_test. Tidak bind port
      Mongo. Tambahkan guard database name pada script fixture.
- [ ] inventory membaca packages entries selain ""; package name dari segmen
      terakhir node_modules/, scoped name dua segmen; pertahankan semua path.
      Jika lock schema tidak didukung throw LOCK_SCHEMA, bukan [].
- [ ] check-suites.json memetakan packageId ke array {cwd,command,args};
      check.mjs memakai spawn(command,args,{shell:false,stdio:"inherit"}),
      validasi cwd di repo, exit nonzero saat satu command gagal. Suite M01-A
      menjalankan node --test scripts/security/inventory.test.mjs. Paket berikut
      wajib mendaftarkan tesnya pada file yang sama.
- [ ] CLI inventory menghasilkan artifacts/security/{root,web}-inventory.json,
      advisory-response.json, lock-hashes.json dan checkedAt. Bulk endpoint
      gagal HTTP/JSON -> exit nonzero. Sertakan prod/dev/optional/path dan
      sumber advisory, tidak mencetak env/credential.
- [ ] Workflow harian/Dependabot hanya memeriksa dan membuat update issue/PR,
      tanpa auto-merge. Pertahankan checkout/setup action SHA. Scope permissions
      minimum contents:read; issue write hanya job pembuka issue.
- [ ] Preflight manifest images/Node/Mongo dan kernel incompatibility dicatat.
      Jalankan audit graph baseline; minimatch blocker menjadi tiket tersendiri,
      bukan hasil nol.

- [ ] .gitignore tambah artifacts/, Playwright reports/authstate, frontend
      .next/node_modules, deployment secrets. Tidak mengabaikan
      source/docs/lockfiles. Check runner memvalidasi artifact yang wajib, bukan
      hanya exitcode.
- [ ] Buat scripts/test-ts.mjs: esbuild bundle test TS ke artifacts/tests,
      platformnode/targetnode24/packagesexternal/formatcjs; spawn node --test,
      exit sama dengan child. Batasi input/output pada repo/artifacts.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

node --test scripts/security/inventory.test.mjs => pass; malformed lock =>
LOCK_SCHEMA; registry offline => check gagal; verify container memakai database
genieacs_plan_test. Inventaris dan hash lock root tetap sama sebelum upgrade.
Log security.scan.completed berisi counts, timestamp dan sumber, tanpa tree env.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'docker/development/Dockerfile' 'compose.test.yaml' 'scripts/check.mjs' 'scripts/check-suites.json' 'scripts/security/inventory.mjs' 'scripts/security/inventory.test.mjs' 'docs/testing/README.md' '.github/workflows/dependency-security.yml' '.github/dependabot.yml' '.gitignore' 'scripts/test-ts.mjs'
git commit -m 'chore(security): add dependency inventory and isolated verification'
git push -u origin chore/m01-a
```

Judul PR:
`[ARD-164] M01-A — Tooling, inventaris keamanan dan harness terisolasi`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** Jika registry/digest tak dapat diverifikasi atau
parent minimatch belum patched, hentikan penerimaan upgrade tooling dan catat
blocker. Tidak memakai --force/legacy-peer-deps. Jangan menjalankan audit/build
script tak dipercaya di host; semua nanti di project test terisolasi.

---

## M01-B — Upgrade dependency backend dengan regresi driver/router

**Linear:**
[ARD-165](https://linear.app/ardani/issue/ARD-165/m01-b-upgrade-dependency-backend-dengan-regresi-driverrouter).
**Status:** Planned / Backlog. **Prasyarat:** M01-A harness merged; security
blocker tooling ditutup atau PR pengecualian manusia tercatat. **Branch:**
`chore/m01-b`.

**Read set:**

- `docs/design/security-upgrade.md`
- `lib/cache.ts`
- `lib/lock.ts`
- `lib/db/synth.ts`
- `lib/ui/api.ts`
- `lib/ui/db.ts`
- `lib/nbi.ts`
- `lib/fs.ts`
- `.eslintrc.json`
- `ui/.eslintrc.json`

**Write set (buat jika belum ada):**

- `package.json`
- `npm-shrinkwrap.json`
- `eslint.config.mjs`
- `.eslintrc.json`
- `build/build.ts`
- `build/lint.ts`
- `lib/cache.ts`
- `lib/lock.ts`
- `lib/db/synth.ts`
- `test/db.ts`
- `test/security-compat.ts`
- `scripts/check-suites.json`
- `.github/workflows/ci.yml`
- `ui/.eslintrc.json`

**Interfaces:** Pertahankan API engine. Cache/lock hasil ModifyResult; EJSON
memakai BSON dari mongodb7.8.0. Tidak mengubah makna count/filter/GridFS string
ID.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c chore/m01-b
```

- [ ] **2. Tambahkan tes perilaku pertama** pada `test/db.ts`. Assertion berikut
      adalah awal; skenario penerimaan langkah4 harus ditambahkan pada berkas
      tes write set.

```tsx
import test from "node:test";
import assert from "node:assert/strict";
import { MongoClient, BSON } from "mongodb";
test("driver metadata and BSON have one compatible identity", async () => {
  const c = new MongoClient(process.env.MONGO_URL!);
  await c.connect();
  try {
    const t = c.db().collection("compat");
    await t.deleteMany({});
    await t.insertOne({ _id: "cache", value: "stored" } as any);
    const r = await t.findOneAndDelete({ _id: "cache" } as any, {
      includeResultMetadata: true,
    });
    assert.equal(r.value?.value, "stored");
    const x = BSON.EJSON.parse('{"_id":{"$oid":"507f1f77bcf86cd799439011"}}');
    await t.insertOne(x);
    assert.ok(await t.findOne({ _id: x._id }));
  } finally {
    await c.close();
  }
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M01-B
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Ubah direct pins sesuai tabel security-upgrade: router15.7.1,
      bodyparser6.1.0, mongodb7.8.0, esbuild0.28.2, svgo3.3.5; Koa2.16.4/TS5.9.3
      dipertahankan. Pindah lint flat config ESLint/ts-eslint kandidat hanya
      sesudah blocker dependency terselesaikan.
- [ ] Pada cache.findOneAndDelete dan lock.findOneAndUpdate tambahkan
      includeResultMetadata:true di object options yang sudah ada. Jangan
      mengganti r.value dengan document.value karena field token juga bernama
      value.
- [ ] Di synth/test db ganti import EJSON direct bson dengan import { BSON }
      from "mongodb"; const { EJSON } = BSON; hapus direct bson4 root.
- [ ] Port aturan .eslintrc ke eslint.config.mjs: gunakan parser/plugin baru,
      tsconfig project root, pertahankan no-floating/no-misused-promises,
      no-shadow, typed return, explicit-any0, eqeqeq null-ignore dan rule lain
      yang masih tersedia. Rule removed perlu dicatat penggantinya, bukan
      menurunkan lint diam-diam.
- [ ] Regenerate shrinkwrap di Node24 tooling, review diff prod/dev/optional
      graph. Perbaiki qs/ip-address/XML/source-map/js-yaml/brace expansion lewat
      parent compatible; jangan override major tanpa paket koreksi rencana.
- [ ] Test node driver, lock actual helper, cache miss, GridFS streaming, router
      .csv/HEAD/encodedID, JSON malformed/size. Build harus exit nonzero pada
      error: tangkap catch upstream build yang menelan error dan set
      process.exitCode=1.

- [ ] UI flat-config override mempertahankan globals dan rules
      ui/.eslintrc.json; baru hapus dua legacy .eslintrc.json setelah aturan
      ekuivalen teruji.
- [ ] Set engines.node root >=24.22.2 <25 dan setup-node CI24.22.2 persis. Uji
      build target dan catat perubahan minimum runtime pada migration note.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

Suite M01-B mencakup test/security-compat.ts + test/db.ts + semua25tes baseline;
router integration401/403/404/405 dan GridFS checksum/range/abort. npm ci ulang,
tsc/eslint/build artifact empat bin+aset lulus. Audit resolved prod/dev dan
image; laporan advisory path per path, jangan label CVE-free hanya dari package
langsung.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'package.json' 'npm-shrinkwrap.json' 'eslint.config.mjs' '.eslintrc.json' 'build/build.ts' 'build/lint.ts' 'lib/cache.ts' 'lib/lock.ts' 'lib/db/synth.ts' 'test/db.ts' 'test/security-compat.ts' 'scripts/check-suites.json' 'ui/.eslintrc.json' '.github/workflows/ci.yml'
git commit -m 'fix(deps): patch backend dependencies and preserve engine behavior'
git push -u origin chore/m01-b
```

Judul PR:
`[ARD-165] M01-B — Upgrade dependency backend dengan regresi driver/router`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** Jika string file IDs berubah, result.value rusak,
peer conflict, atau output lock tidak reproducible, stop. Revert hanya perubahan
paket ini di branch fitur; database fixture boleh reset oleh guard nama, volume
referensi tidak disentuh.

---

## M01-C — Scaffold frontend patched dan boundary kontrak

**Linear:**
[ARD-166](https://linear.app/ardani/issue/ARD-166/m01-c-scaffold-frontend-patched-dan-boundary-kontrak).
**Status:** Planned / Backlog. **Prasyarat:** M01-B. **Branch:**
`feature/m01-c`.

**Read set:**

- `docs/design/contracts.md`
- `docs/design/security-upgrade.md`
- `tsconfig.json`
- `.github/workflows/ci.yml`

**Write set (buat jika belum ada):**

- `apps/web/package.json`
- `apps/web/package-lock.json`
- `apps/web/tsconfig.json`
- `apps/web/next.config.ts`
- `apps/web/eslint.config.mjs`
- `apps/web/vitest.config.ts`
- `apps/web/playwright.config.ts`
- `apps/web/src/app/layout.tsx`
- `apps/web/src/app/page.tsx`
- `apps/web/src/app/error.tsx`
- `apps/web/src/app/global-error.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/test/setup.ts`
- `apps/web/src/app/page.test.tsx`
- `packages/app-contracts/src/api.ts`
- `packages/app-contracts/src/validators.ts`
- `.github/workflows/ci.yml`
- `.gitignore`
- `docker/web/Dockerfile`
- `scripts/check-suites.json`
- `docker/testing/Dockerfile`
- `compose.test.yaml`

**Interfaces:** Menghasilkan ApiResult<T>/ErrorCode/SessionDTO/Page<T> persis
contracts; assertApiResult(value):void validator strict envelope. Next
standalone Node runtime, bukan static export.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m01-c
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `apps/web/src/app/page.test.tsx`. Assertion berikut adalah awal; skenario
      penerimaan langkah4 harus ditambahkan pada berkas tes write set.

```tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import Home from "./page";
test("renders neutral application entry without customer data", () => {
  render(<Home />);
  expect(screen.getByRole("heading", { name: "GenieACS PWA" })).toBeVisible();
  expect(screen.queryByText(/password|pppoe/i)).toBeNull();
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M01-C
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Buat app manual dengan exact pins Next16.4.3, React/DOM19.3.1,
      sharp0.35.5, types dan test stack dari security-upgrade. Tidak memakai
      create-next-app/latest atau menambah UI/query/form packages.
- [ ] package scripts dev/start/build=next, lint=eslint src e2e, typecheck=tsc
      --noEmit, test=vitest, test:e2e=playwright test. Config alias @/_=src/_
      dan @contracts/_=../../packages/app-contracts/src/_; strict true, Node
      runtime untuk BFF.
- [ ] next.config output standalone dan outputFileTracingRoot repo root; matikan
      poweredByHeader. Dynamic/session routes force-dynamic/no-store. Global
      headers nosniff/frameDENY/referrer policy. Jangan mengaktifkan
      cacheComponents untuk data operator.
- [ ] CSS Modules/variables, layout system font tanpa remote requests, entry
      heading netral. Error boundaries menampilkan pesan+requestId; pelapor
      tersanitasi disambungkan M03-C.
- [ ] Validasi DTO tanpa dependency tambahan: periksa object/primitive/enum,
      reject unknown security input keys; error fieldErrors per field. Jangan
      cast JSON tak tervalidasi menjadi DTO.
- [ ] Vitest jsdom, setup import jest-dom/vitest, restoreMocks. Playwright
      baseURL http://web:3000 di compose test dan viewport projects360/768/1440.
      Suite smoke render entry/build/typecheck; CI menambah npm ci --prefix
      apps/web, lint/type/test/build dan verifikasi standalone server ada.

- [ ] Docker testing image memakai Node pin, npm ci frontend + playwright
      install --with-deps chromium pada build terisolasi. Service browser-tests
      network_mode service:web pada compose.test; baseURL http://localhost:3000
      untuk pengecualian secure-context loopback, berbeda dari verify unit
      container. Jangan mematikan keamanan browser untuk PWA.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M01-C unit pass + next build; npm ls peer clean; external Next/React/sharp pins
terverifikasi, artifact SBOM termasuk bundled RSC. Source ui/ Mithril dan
backend bin masih dibangun. Tidak ada localStorage/IndexedDB/session token
browser. Docker web running nonroot UID10001, root filesystem read-only dengan
tmpfs cache/tmp yang dibutuhkan.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'apps/web/package.json' 'apps/web/package-lock.json' 'apps/web/tsconfig.json' 'apps/web/next.config.ts' 'apps/web/eslint.config.mjs' 'apps/web/vitest.config.ts' 'apps/web/playwright.config.ts' 'apps/web/src/app/layout.tsx' 'apps/web/src/app/page.tsx' 'apps/web/src/app/error.tsx' 'apps/web/src/app/global-error.tsx' 'apps/web/src/app/globals.css' 'apps/web/src/test/setup.ts' 'apps/web/src/app/page.test.tsx' 'packages/app-contracts/src/api.ts' 'packages/app-contracts/src/validators.ts' '.github/workflows/ci.yml' '.gitignore' 'docker/web/Dockerfile' 'scripts/check-suites.json' 'docker/testing/Dockerfile' 'compose.test.yaml'
git commit -m 'feat(web): scaffold patched Next application and shared contracts'
git push -u origin feature/m01-c
```

Judul PR: `[ARD-166] M01-C — Scaffold frontend patched dan boundary kontrak`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** Jika graph lint masih membawa blocker minimatch
yang belum ditutup, jangan menyembunyikan dengan omit audit. Stop gate paket,
aplikasi frontend belum dinyatakan patched penuh. Runtime/folder referensi tidak
digunakan sebagai build context.

---

## M01-D — Runtime Docker dan fondasi L2TP terpisah dashboard

**Linear:**
[ARD-167](https://linear.app/ardani/issue/ARD-167/m01-d-runtime-docker-dan-fondasi-l2tp-terpisah-dashboard).
**Status:** Planned / Backlog. **Prasyarat:** M01-C. **Branch:**
`feature/m01-d`.

**Read set:**

- `docs/design/contracts.md`
- `docs/design/security-upgrade.md`
- `compose.dev.yaml`

**Write set (buat jika belum ada):**

- `compose.yaml`
- `compose.test.yaml`
- `compose.https.yaml`
- `.env.example`
- `docker/engine/Dockerfile`
- `docker/vpn/Dockerfile`
- `docker/vpn/entrypoint.sh`
- `docker/health.mjs`
- `scripts/preflight.mjs`
- `scripts/preflight.test.mjs`
- `docker/runtime-images.json`
- `docs/deployment/docker.md`
- `apps/web/src/app/api/app/health/route.ts`
- `scripts/check-suites.json`
- `docker/caddy/Caddyfile`

**Interfaces:** PreflightReport
{supported:boolean,checks:{id,status:'pass'|'fail'|'warn',message}[]};
runPreflight(platformFacts):PreflightReport. /dev/ppp validation, namespace
cwmp/fs only. Stage1 VPN memakai bootstrap profile, pengelolaan persist UI
M07-A.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m01-d
```

- [ ] **2. Tambahkan tes perilaku pertama** pada `scripts/preflight.test.mjs`.
      Assertion berikut adalah awal; skenario penerimaan langkah4 harus
      ditambahkan pada berkas tes write set.

```js
import test from "node:test";
import assert from "node:assert/strict";
import { runPreflight } from "./preflight.mjs";
test("PPP absence is actionable and never reported connected", () => {
  const r = runPreflight({
    os: "linux",
    rootful: true,
    kernel: "6.18.0",
    pppDevice: false,
    pppModules: false,
    routeOverlap: false,
  });
  assert.equal(r.supported, false);
  assert.equal(r.checks.find((x) => x.id === "ppp")?.status, "fail");
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M01-D
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Buat multi-stage engine build dari source fork Node24.22.2+pin digest;
      copy dist dan npm ci --omit=dev runtime. Pisah command cwmp/fs/ui/nbi
      memakai artifact yang sama. Label app/upstream/commit.
- [ ] Compose bridge app dan vpn-control; web/acs-ui tanpa network_mode vpn.
      cwmp/fs namespace service:vpn; published7547/7567 ada vpn; web port3000
      default bind configurable. NBI/UI/Mongo/log agent tanpa hostports. Jangan
      memakai container_name tetap.
- [ ] VPN image memasang xl2tpd/ppp/iproute2 versions terpin dari repository
      package metadata yang discan; health memeriksa state PPP dan mengembalikan
      alasan, bukan mengklaim ONT reachable. NET_ADMIN+/dev/ppp; overlay WSL
      SYS_MODULE hanya bila preflight memerlukan.
- [ ] preflight memeriksa kernel, /dev/ppp, modules, subnet overlap dan Mongo
      kernel range; tidak memuat module/merombak route otomatis tanpa target
      host jelas. Jalankan dari deployment context, output JSON tanpa env.
- [ ] Compose init/restart unless-stopped, log rotation10m×3, Mongo user auth,
      named volumes, health start periods. Route /api/app/health memakai GET
      native /status dengan timeout2s, no-store, safe field
      web/backendReachable/observedAt. Web dependency tidak bergantung vpn
      healthy; endpoint web sehat ketika vpn stopped.
- [ ] HTTPS overlay menerima cert/key trusted melalui filemount read-only;
      dokumentasikan PUBLIC_ORIGIN dan trusted proxy boundary. Tidak menerbitkan
      domain/certificate sungguhan dalam paket otomatis.
- [ ] compose.test memisahkan port5300 loopback, project genieacs-pwa-check,
      simulator VPN state tanpa NET_ADMIN; hardware PPP hanya smoke lab
      terpisah. .env.example berisi placeholder dummy, tidak menyalin .env
      referensi.

- [ ] HTTPS overlay memakai Caddy2.11.7 terpin digest, cert/key trusted
      read-only, reverse_proxy ke web dengan timeout task≥310detik. Caddyfile
      tidak meneruskan forwarded header client tanpa override proxy terpercaya.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

Suite M01-D: compose config static asserts port/network/volumes, preflight
fixtures Linux/WSL unsupported/overlap/kernel. Stack test up lalu stop simulated
vpn: GET web health tetap200, device/network state unavailable. Restart mongo
persistence fixture; reboot container tidak menghapus DB. Test rootful Linux+WSL
PPP dicatat sebagai lab gate, bukan simulator success.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'compose.yaml' 'compose.test.yaml' 'compose.https.yaml' '.env.example' 'docker/engine/Dockerfile' 'docker/vpn/Dockerfile' 'docker/vpn/entrypoint.sh' 'docker/health.mjs' 'scripts/preflight.mjs' 'scripts/preflight.test.mjs' 'docker/runtime-images.json' 'docs/deployment/docker.md' 'apps/web/src/app/api/app/health/route.ts' 'scripts/check-suites.json' 'docker/caddy/Caddyfile'
git commit -m 'feat(docker): isolate dashboard networking and package L2TP runtime'
git push -u origin feature/m01-d
```

Judul PR:
`[ARD-167] M01-D — Runtime Docker dan fondasi L2TP terpisah dashboard`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** Jika host PPP tidak tersedia, tandai
host_unsupported dan berhenti lab test; web tetap dapat dites. Jangan
privileged:true atau expose Docker socket. Down hanya project
genieacs-pwa-check, tanpa -v untuk data nonfixture.

---

## M01-E — Logger JSON, redaksi dan availability saat storage gagal

**Linear:**
[ARD-168](https://linear.app/ardani/issue/ARD-168/m01-e-logger-json-redaksi-dan-availability-saat-storage-gagal).
**Status:** Planned / Backlog. **Prasyarat:** M01-D. **Branch:**
`feature/m01-e`.

**Read set:**

- `docs/design/contracts.md`
- `lib/logger.ts`
- `lib/debug.ts`

**Write set (buat jika belum ada):**

- `packages/app-contracts/src/log.ts`
- `lib/app-logger.ts`
- `lib/logger.ts`
- `lib/debug.ts`
- `test/app-logger.ts`
- `apps/web/src/server/logger.ts`
- `apps/web/src/server/request-context.ts`
- `services/vpn-controller/src/logger.ts`
- `scripts/check-suites.json`

**Interfaces:** LogEvent/LoggingState kontrak; redact(value):unknown;
createAppLogger(options):{emit(event):void,status():{state,droppedEvents,lastSuccessAt}};
request context UUID diteruskan antarservice.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m01-e
```

- [ ] **2. Tambahkan tes perilaku pertama** pada `test/app-logger.ts`. Assertion
      berikut adalah awal; skenario penerimaan langkah4 harus ditambahkan pada
      berkas tes write set.

```tsx
import test from "node:test";
import assert from "node:assert/strict";
import { redact } from "../lib/app-logger.ts";
test("redacts typed values, nested secrets and URL credentials", () => {
  const s = JSON.stringify(
    redact({
      authorization: "Bearer dummy-secret",
      nested: { password: "dummy-password" },
      parameterValues: [
        ["Device.WiFi.SSID.1.PreSharedKey", "dummy-key", "xsd:string"],
      ],
      url: "https://user:dummy-url@example.invalid/?token=dummy-query",
    }),
  );
  for (const x of [
    "dummy-secret",
    "dummy-password",
    "dummy-key",
    "dummy-url",
    "dummy-query",
  ])
    assert.equal(s.includes(x), false);
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M01-E
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Implementasikan LogEvent schema persis kontrak dan event factory yang
      mengisi installationId/service/version/time server. Details whitelist per
      event; tidak menerima request/body utuh.
- [ ] Redact recursive WeakSet cycle guard, depth≤10/string≤8KiB; key
      case-insensitive, typed SPV tuples/path suffix, URL userinfo/query token.
      Error stack tersanitasi cause; generic property value yang bukan allowlist
      tidak dipersist.
- [ ] Queue bound1000event/2MiB; single async writer, rotate20MiB×5, drop lower
      severity dahulu. Emitter menangkap disk errors tanpa throw; set
      degraded+dropped counter. Timer flush tidak menahan request atau mencegah
      shutdown.
- [ ] Adapter logger engine mengisi envelope access/app tanpa membuang field
      pesan CLI yang dibutuhkan. Raw lib/debug sink dinonaktifkan default;
      opt-in debug memakai redaksi field-level sebelum persist dan
      maxdurasi5menit/device berizin.
- [ ] Request context generate UUID, observe duration/outcome, response
      X-Request-Id; upstream parent ID hanya UUID valid. Web/vpn wrapper memakai
      module redaction bersama, bukan menulis error object sendiri.
- [ ] Tambah handler fatal server flush≤2detik lalu exit1. Handler request error
      mengembalikan safe ApiResult INTERNAL+requestId. Test sink throw
      ENOSPC/EACCES, queueoverflow, cyclic input, simultaneous writes dan
      rotation.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

Suite M01-E memeriksa no secret substring pada stdout/file/error/typed tuples;
ENOSPC emit tidak throw dan elapsed<50ms dengan sink stub; degraded counter
bertambah, recovery state kehealthy setelah berhasil. Log event correlates
web→acs-ui→vpn. Raw CWMP tidak tercatat default.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'packages/app-contracts/src/log.ts' 'lib/app-logger.ts' 'lib/logger.ts' 'lib/debug.ts' 'test/app-logger.ts' 'apps/web/src/server/logger.ts' 'apps/web/src/server/request-context.ts' 'services/vpn-controller/src/logger.ts' 'scripts/check-suites.json'
git commit -m 'feat(logging): add bounded redacted JSON application logs'
git push -u origin feature/m01-e
```

Judul PR:
`[ARD-168] M01-E — Logger JSON, redaksi dan availability saat storage gagal`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** Jika redaksi gagal untuk satu fixture, hentikan
integrasi collector. Jangan menyamarkan kegagalan logger dengan catch kosong:
status/counter wajib berubah. Pemulihan volume hanya stack uji.

---

## M01-F — Vector, VictoriaLogs dan fault injection pipeline

**Linear:**
[ARD-169](https://linear.app/ardani/issue/ARD-169/m01-f-vector-victorialogs-dan-fault-injection-pipeline).
**Status:** Planned / Backlog. **Prasyarat:** M01-E. **Branch:**
`feature/m01-f`.

**Read set:**

- `docs/design/contracts.md`
- `docs/design/security-upgrade.md`

**Write set (buat jika belum ada):**

- `docker/vector/vector.yaml`
- `compose.yaml`
- `compose.test.yaml`
- `docker/health.mjs`
- `test/integration/log-pipeline.ts`
- `scripts/log-smoke.mjs`
- `docs/operations/logging.md`
- `scripts/check-suites.json`

**Interfaces:** Vector NDJSON ingest; VictoriaLogs14d/10000000000byte
target/2GiB free floor; buffer1073741824byte. Logging status source exposes
healthy/buffering/degraded, not only container alive.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m01-f
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `test/integration/log-pipeline.ts`. Assertion berikut adalah awal;
      skenario penerimaan langkah4 harus ditambahkan pada berkas tes write set.

```tsx
import test from "node:test";
import assert from "node:assert/strict";
test("ingested event is searchable by requestId", async () => {
  const id = crypto.randomUUID();
  const event = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    level: "info",
    service: "test",
    installationId: "fixture",
    environment: "test",
    appVersion: "1.2.16",
    event: "pipeline.test",
    message: "fixture",
    requestId: id,
  };
  const ingest = await fetch(process.env.LOG_URL! + "/insert/jsonline", {
    method: "POST",
    body: JSON.stringify(event) + "\n",
  });
  assert.equal(ingest.ok, true);
  const q = await fetch(process.env.LOG_URL! + "/select/logsql/query", {
    method: "POST",
    body: new URLSearchParams({ query: 'requestId:="' + id + '"', limit: "1" }),
  });
  assert.match(await q.text(), new RegExp(id));
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M01-F
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Pin VictoriaLogs1.53.0 and Vector0.61.0-debian digest in
      runtime-images.json after registry inspection; neither9428 nor collector
      API bound public.
- [ ] Vector file source include /logs/_/_.ndjson, read_from beginning +
      persistent checkpoints. VRL schema check/redaction, drop_on_error:true;
      malformed raw message never fallback to unsanitized stream.
- [ ] HTTP sink URL and \_stream_fields exact contracts,
      codecjson/framingnewline_delimited/gzip, request timeout10s+bounded retry,
      disk buffer1GiB when_fullblock+ack. File volume read-only, buffer writable
      separate; no docker socket.
- [ ] Set VictoriaLogs flags retentionPeriod14d,
      retention.maxDiskSpaceUsageBytes10000000000,
      storage.minFreeDiskSpaceBytes2147483648. Probe external Node GET /health;
      don't use unavailable -healthcheck CLI.
- [ ] log-smoke creates one sanitized event, polls bounded10s for requestId
      query and validates record, not just HTTP200. Expose collector/sink
      counters to internal health reader.
- [ ] Fault tests: stop sink=>buffering; restart=>drain and searchable; full
      queue+app log volume injected ENOSPC=>degraded but app read/save recovery
      route works. Use stub filesystem/buffer small test settings instead of
      filling host disk.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

Suite M01-F: valid ingest/query NDJSON, invalid event dropped, no secret marker,
sink restart drain, retention flags static correct and no public9428. Evidence
includes requestId, counters, lastSuccessAt and bounded file/buffer sizes.
Operational docs explain soft quota and shorter actual retention.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'docker/vector/vector.yaml' 'compose.yaml' 'compose.test.yaml' 'docker/health.mjs' 'test/integration/log-pipeline.ts' 'scripts/log-smoke.mjs' 'docs/operations/logging.md' 'scripts/check-suites.json'
git commit -m 'feat(observability): add Vector and VictoriaLogs pipeline'
git push -u origin feature/m01-f
```

Judul PR: `[ARD-169] M01-F — Vector, VictoriaLogs dan fault injection pipeline`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** Ingestion200 with invalid-row metric increment is
failure. Stop acceptance if Vector error route emits original payload or queries
unbounded. Do not run real disk-fill or stop reference containers.

---
