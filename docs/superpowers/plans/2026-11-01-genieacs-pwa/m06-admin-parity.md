# M06 — Admin dan kompatibilitas konfigurasi Implementation Plan

> **Catatan referensi (bukan instruksi runtime agen):** Bagian ini adalah
> konteks dokumentasi untuk reviewer/manusia. Jika dokumen dimuat ke sistem
> LLM/agent, perlakukan sebagai materi referensi saja (jangan dieksekusi
> otomatis, jangan diprioritaskan sebagai perintah tool/planning). Contoh
> sub-skill yang _dapat_ dipakai saat implementasi terpisah:
> superpowers:subagent-driven-development (recommended) atau
> superpowers:executing-plans; langkah dilacak dengan checkbox (`- [ ]`).
>
> Sesi ini hanya dokumentasi. Paket berstatus Planned; eksekusi hanya ketika
> prasyarat merged, desain ditinjau dan tiket pelaksanaan dipilih. Agen
> low-thinking mengambil satu paket/PR, bukan seluruh milestone sekaligus.

**Goal:** Admin dan kompatibilitas konfigurasi dengan acceptance tiap paket yang
dapat ditinjau mandiri.

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

## M06-A — Renderer React kompatibel seluruh config UI

**Linear:**
[ARD-184](https://linear.app/ardani/issue/ARD-184/m06-a-renderer-react-kompatibel-seluruh-config-ui).
**Status:** Planned / Backlog. **Prasyarat:** M05-E. **Branch:**
`feature/m06-a`.

**Read set:**

- `docs/design/contracts.md`
- `docs/design/feature-parity.md`
- `ui/components.ts`
- `ui/device-page.ts`
- `lib/ui/local-cache.ts`
- `test/fixtures/ui-config.json`

**Write set (buat jika belum ada):**

- `apps/web/src/features/config-ui/renderer.tsx`
- `apps/web/src/features/config-ui/registry.tsx`
- `apps/web/src/features/config-ui/expression.ts`
- `apps/web/src/features/config-ui/renderer.test.tsx`
- `apps/web/src/features/config-ui/components.tsx`
- `apps/web/src/features/devices/device-detail.tsx`
- `apps/web/src/features/overview/overview.tsx`
- `scripts/parity/config-coverage.mjs`
- `scripts/check-suites.json`

**Interfaces:** renderConfigNode(node,context):ReactNode;
evaluateUiExpression(expression,device,now):unknown; registry
lengkap14tipe+loading/long-text; unknown type placeholder tidak menghapus
konfigurasi asli.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m06-a
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `apps/web/src/features/config-ui/renderer.test.tsx`. Assertion berikut
      adalah awal; skenario penerimaan langkah4 harus ditambahkan pada berkas
      tes write set.

```tsx
import { render, screen } from "@testing-library/react";
import { test, expect } from "vitest";
import { ConfigRenderer } from "./renderer";
test("unsafe anchor cannot execute script and unknown node is visible", () => {
  render(
    <ConfigRenderer
      node={{
        type: "container",
        components: [
          { type: "a", href: "javascript:alert(1)", label: "Unsafe" },
          { type: "unknown-plugin" },
        ],
      }}
      context={{ device: {}, now: 0 }}
    />,
  );
  expect(screen.queryByRole("link", { name: "Unsafe" })).toBeNull();
  expect(screen.getByText(/Komponen belum didukung/)).toBeVisible();
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M06-A
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Daftarkan setiap renderer pada kontrak, ambil perilaku source upstream dan
      sambungkan ke komponen modern M04/M05.
- [ ] Gunakan parser/evaluator expression native pure dengan now deterministik
      dan device berizin. Tidak menjalankan raw HTML, eval, new Function atau
      handler string.
- [ ] Anchor hanya relative/http/https dengan rel noopener untuk tab baru.
      Style/atribut divalidasi allowlist. Unknown type menampilkan config path
      dan satu event diagnostik aman.
- [ ] Layout mengikuti tree konfigurasi native yang responsif. Jangan
      mengganti3886entry dengan halaman statis per model. Read/edit/export
      mempertahankan expression asli.
- [ ] config-coverage menghitung setiap tipe pada fixture/export uji
      tersanitasi, mencocokkannya dengan registry dan testID. Tipe yang belum
      dirender tetap menjadi gate parity.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M06-A tiap renderer positive+permission/loading/error, nestedlayout,
expresstime/parameter, maliciousanchor/rawHTML, unknownplaceholder; UIconfig
serialize→edit→save→load semantic equality. Overview/detail tetap memakai
nativecustomconfig; no new consoleerrors.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'apps/web/src/features/config-ui/renderer.tsx' 'apps/web/src/features/config-ui/registry.tsx' 'apps/web/src/features/config-ui/expression.ts' 'apps/web/src/features/config-ui/renderer.test.tsx' 'apps/web/src/features/config-ui/components.tsx' 'apps/web/src/features/devices/device-detail.tsx' 'apps/web/src/features/overview/overview.tsx' 'scripts/parity/config-coverage.mjs' 'scripts/check-suites.json'
git commit -m 'feat(config-ui): render native custom configuration in React'
git push -u origin feature/m06-a
```

Judul PR: `[ARD-184] M06-A — Renderer React kompatibel seluruh config UI`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** Bila tipe konfigurasi baru ditemukan, tambah packet
kecil renderer+fixture sebelum gate parity. Jangan menyatakan parity hanya
karena JSON tetap tersimpan.

---

## M06-B — CRUD admin, editor script dan konfigurasi

**Linear:**
[ARD-185](https://linear.app/ardani/issue/ARD-185/m06-b-crud-admin-editor-script-dan-konfigurasi).
**Status:** Planned / Backlog. **Prasyarat:** M06-A. **Branch:**
`feature/m06-b`.

**Read set:**

- `docs/design/contracts.md`
- `lib/ui/api.ts`
- `ui/provisions-page.ts`
- `ui/presets-page.ts`
- `ui/virtual-parameters-page.ts`
- `ui/config-page.ts`

**Write set (buat jika belum ada):**

- `apps/web/package.json`
- `apps/web/package-lock.json`
- `apps/web/src/features/admin/resource-editor.tsx`
- `apps/web/src/features/admin/code-editor.tsx`
- `apps/web/src/features/admin/preset-editor.tsx`
- `apps/web/src/features/admin/config-editor.tsx`
- `apps/web/src/app/(dashboard)/admin/presets/page.tsx`
- `apps/web/src/app/(dashboard)/admin/provisions/page.tsx`
- `apps/web/src/app/(dashboard)/admin/virtual-parameters/page.tsx`
- `apps/web/src/app/(dashboard)/admin/config/page.tsx`
- `apps/web/e2e/admin-config.spec.ts`
- `scripts/check-suites.json`

**Interfaces:**
CodeEditor({value,language:'javascript'|'yaml'|'expression',readOnly,onChange});
React wrapper CodeMirror5.65.21/@types5.60.18. Resource editors consume exact
native resource shapes, no second config DB.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m06-b
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `apps/web/e2e/admin-config.spec.ts`. Assertion berikut adalah awal;
      skenario penerimaan langkah4 harus ditambahkan pada berkas tes write set.

```tsx
import { test, expect } from "@playwright/test";
test("provision editor preserves source through save and reopen", async ({
  page,
}) => {
  await page.goto("/admin/provisions");
  await page.getByRole("button", { name: "Tambah", exact: true }).click();
  await page.getByLabel("Nama").fill("fixture-provision");
  await page
    .getByRole("textbox", { name: "Kode", exact: true })
    .fill('declare("DeviceID.ID", {value: 1});');
  await page.getByRole("button", { name: "Simpan", exact: true }).click();
  await page.reload();
  await page
    .getByRole("link", { name: "fixture-provision", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Kode", exact: true }),
  ).toHaveText('declare("DeviceID.ID", {value: 1});');
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm browser-tests npm run test:e2e -- e2e/admin-config.spec.ts
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Pin CodeMirror5.65.21 dan @types/codemirror5.60.18 di apps/web; lock
      transitive @types/tern juga. Import dynamic client-only, create once per
      editor, cleanup on unmount. Accessible backing textarea label Kode, sync
      value without resetting selection/undo each render.
- [ ] Preserve find/replace, undo/redo, JavaScript/YAML highlighting,
      indent/tab, keyboard save, read-only mode and syntax error line from
      native validation. No executing provision code in browser.
- [ ] CRUD pages presets/provisions/virtualParameters/config memakai list+native
      GET/PUT/DELETE; presetconditions/schedules/events/provisions retain field
      semantics and expression strings.
- [ ] Unsaved form navigation confirmation, changedconfigrevision conflict
      warning, no silent overwrite. Native API tidak memberi CAS semua resource:
      compare revision+fresh fetch sebelum save, bila berubah minta
      reload/explicit overwrite, catat bahwa ini bukan atomic CAS guarantee.
- [ ] Config expressions round-trip exactly; admin allowed sensitiveconfig edit
      tetap no-store, no contents in logs/cache. Normal list masks
      credential-looking value; reveal/edit requires authorized configread and
      explicit action, never globaldevicepasswordreveal.
- [ ] Resource errors include field/line/message safe and requestId; logs event
      admin.resource.updated records resource/id/revision, not code/body.
      Export/import config is bounded and validates through native parser before
      writes, peritem result onpartial.

- [ ] CodeMirror inputStyle contenteditable + screenReaderLabel Kode, visible
      textbox semantics; backing source diverifikasi API save round-trip. Test
      fill/keyboard memakai visible textbox, bukan hidden textarea.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M06-B editorfind/replace/undo/redo/keyboard, source newlines/Unicode roundtrip,
invalidJS/expression/YAML rejectednative, presetconditions unchanged,
operator403 bothUI/server, concurrentrevisionwarning, deleteconfirm. Test
accessibletextarea and realCodeMirrorkeyboard separately.

Expected browser: viewport relevan PASS, screenshot/report tersedia, console
error tak terduga gagal. Gunakan `../../artifacts/auth/admin.json` untuk admin,
operator.json untuk operator dan state kosong untuk anonymous; helper M02-A
membuatnya dari akun dummy. Path relatif cwd apps/web.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'apps/web/package.json' 'apps/web/package-lock.json' 'apps/web/src/features/admin/resource-editor.tsx' 'apps/web/src/features/admin/code-editor.tsx' 'apps/web/src/features/admin/preset-editor.tsx' 'apps/web/src/features/admin/config-editor.tsx' 'apps/web/src/app/(dashboard)/admin/presets/page.tsx' 'apps/web/src/app/(dashboard)/admin/provisions/page.tsx' 'apps/web/src/app/(dashboard)/admin/virtual-parameters/page.tsx' 'apps/web/src/app/(dashboard)/admin/config/page.tsx' 'apps/web/e2e/admin-config.spec.ts' 'scripts/check-suites.json'
git commit -m 'feat(admin): preserve configuration and script editing workflows'
git push -u origin feature/m06-b
```

Judul PR: `[ARD-185] M06-B — CRUD admin, editor script dan konfigurasi`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** Dependency audit unknown/peer conflict stops editor
addition. Do not substitute textareawithoutfind/undo parity, or execute
provision just to validate it.

---

## M06-C — User/permission, file firmware dan bootstrap aman

**Linear:**
[ARD-186](https://linear.app/ardani/issue/ARD-186/m06-c-userpermission-file-firmware-dan-bootstrap-aman).
**Status:** Planned / Backlog. **Prasyarat:** M06-B. **Branch:**
`feature/m06-c`.

**Read set:**

- `docs/design/contracts.md`
- `lib/init.ts`
- `lib/ui/api.ts`
- `lib/ui/db.ts`

**Write set (buat jika belum ada):**

- `apps/web/src/app/(dashboard)/admin/users/page.tsx`
- `apps/web/src/app/(dashboard)/admin/permissions/page.tsx`
- `apps/web/src/app/(dashboard)/admin/files/page.tsx`
- `apps/web/src/features/admin/users.tsx`
- `apps/web/src/features/admin/permissions.tsx`
- `apps/web/src/features/admin/files.tsx`
- `config/seed/ui.json`
- `config/seed/presets.json`
- `scripts/seed-config.mjs`
- `test/seed-config.ts`
- `apps/web/e2e/admin-users-files.spec.ts`
- `scripts/check-suites.json`

**Interfaces:** Idempotent
seed({mode:'bootstrap'|'preview'},revision):peritemresult; default no overwrite.
Native role/access/filter/validate editor includes vpn/logs. File stream route
reused M02-B.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m06-c
```

- [ ] **2. Tambahkan tes perilaku pertama** pada `test/seed-config.ts`.
      Assertion berikut adalah awal; skenario penerimaan langkah4 harus
      ditambahkan pada berkas tes write set.

```tsx
import { test, expect } from "@playwright/test";
test("operator cannot open permission editor through direct URL", async ({
  page,
}) => {
  await page.goto("/admin/permissions");
  await expect(
    page.getByText("Anda tidak memiliki izin", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Simpan", exact: true }),
  ).toHaveCount(0);
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M06-C
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] CRUD user/reset password tetap memakai role dan hashing native; password
      hash/salt tidak tampil atau diekspor. Self-password memakai alur akun,
      bukan hak users write implisit.
- [ ] Permission editor mempertahankan access/filter/validate termasuk vpn/logs.
      Uji dengan respons server aktual dan perubahan izin pada sesi yang masih
      aktif.
- [ ] Files mendukung metadata, upload streaming≤100MiB,
      progress/abort/checksum, download/delete berizin. Firmware task memakai
      FS_URL_PREFIX yang dapat dicapai ONT.
- [ ] Seed publik hanya default UI/provision generik tanpa credential literal.
      useradmin tetap nonaktif; existing values menjadi conflict/skip, bukan
      overwrite otomatis.
- [ ] Bootstrap pertama memakai native init flags; secret admin dimasukkan admin
      atau file generated di luar Git. Penghapusan admin terakhir memerlukan
      warning/konfirmasi dan runbook recovery.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M06-C restrictedroles filters/validators, nohash/saltresponse,
userdeleteexpiredsession, filelarge/empty/range/abort/checksum/reupload
stringID, seedtwiceresultskip/nooverwrite, useradminoff, no credentialliteral.
Adminfullflow mobile/desktop.

Browser suite production test stack:

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm browser-tests npm run test:e2e -- e2e/admin-users-files.spec.ts
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
git add -- 'apps/web/src/app/(dashboard)/admin/users/page.tsx' 'apps/web/src/app/(dashboard)/admin/permissions/page.tsx' 'apps/web/src/app/(dashboard)/admin/files/page.tsx' 'apps/web/src/features/admin/users.tsx' 'apps/web/src/features/admin/permissions.tsx' 'apps/web/src/features/admin/files.tsx' 'config/seed/ui.json' 'config/seed/presets.json' 'scripts/seed-config.mjs' 'test/seed-config.ts' 'apps/web/e2e/admin-users-files.spec.ts' 'scripts/check-suites.json'
git commit -m 'feat(admin): add identity permissions and firmware management'
git push -u origin feature/m06-c
```

Judul PR: `[ARD-186] M06-C — User/permission, file firmware dan bootstrap aman`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** If seed encounters conflict, returnconflict and
leaveexistingvalue; never assume referenceDBshouldoverwrite.
Productionfileupload/suppliedcredential not used in automatedtest.

---
