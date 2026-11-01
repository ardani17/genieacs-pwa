# M03 — Sistem desain dan pengalaman mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.
>
> Sesi ini hanya dokumentasi. Paket berstatus Planned; eksekusi hanya ketika
> prasyarat merged, desain ditinjau dan tiket pelaksanaan dipilih. Agen
> low-thinking mengambil satu paket/PR, bukan seluruh milestone sekaligus.

**Goal:** Sistem desain dan pengalaman mobile dengan acceptance tiap paket yang
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

## M03-A — Token visual dan komponen aksesibel

**Linear:**
[ARD-173](https://linear.app/ardani/issue/ARD-173/m03-a-token-visual-dan-komponen-aksesibel).
**Status:** Planned / Backlog. **Prasyarat:** M02-C. **Branch:**
`feature/m03-a`.

**Read set:**

- `docs/design/contracts.md`

**Write set (buat jika belum ada):**

- `apps/web/src/app/globals.css`
- `apps/web/src/components/ui/button.tsx`
- `apps/web/src/components/ui/field.tsx`
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/ui/status.tsx`
- `apps/web/src/components/ui/data-view.tsx`
- `apps/web/src/components/ui/ui.module.css`
- `apps/web/src/components/ui/ui.test.tsx`
- `apps/web/e2e/components.spec.ts`
- `scripts/check-suites.json`

**Interfaces:** Button/Field/Dialog/Status/DataView typed React props; status
label+icon+text; Dialog onClose restores focus; DataView accepts
loading|empty|error|ready, never infers from empty array while loading.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m03-a
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `apps/web/src/components/ui/ui.test.tsx`. Assertion berikut adalah awal;
      skenario penerimaan langkah4 harus ditambahkan pada berkas tes write set.

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { Dialog } from "./dialog";
test("dialog traps focus and closes on Escape", async () => {
  const user = userEvent.setup();
  let closed = false;
  render(
    <Dialog
      open
      title="Konfirmasi"
      onClose={() => {
        closed = true;
      }}
    >
      <button>Batal</button>
      <button>Simpan</button>
    </Dialog>,
  );
  expect(screen.getByRole("dialog", { name: "Konfirmasi" })).toHaveAttribute(
    "aria-modal",
    "true",
  );
  await user.keyboard("{Escape}");
  expect(closed).toBe(true);
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M03-A
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Set exact CSS tokens/font/spacing/radius from contracts; primary white
      text contrast, muted readable. Inline SVG local icon component with title
      or aria-hidden, no iconfont/networkassets.
- [ ] Button variants primary/secondary/danger, disabled+busy semantics; Field
      htmlFor/id/error aria-describedby, required label. Status icon+text
      aria-live polite.
- [ ] Dialog uses native <dialog> with showModal/close effect, focus first
      enabled element, restore trigger, Escape cancel, backdrop only if no
      destructive in-flight operation. Form validation errors focus first field.
- [ ] DataView owns loading skeleton aria-busy, empty call to action, safe
      error+requestId+retry, no permission UI data leak. Cards/table use same
      fields without hidden duplicate tabbable controls.
- [ ] Add responsive fixture route only in test build, component e2e360/768/1440
      keyboard/tab/zoom200%; no page overflow; touch target44px. Capture
      screenshots in artifacts/ui/M03-A/.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M03-A Vitest focus/labels/status/error tests; Playwright keyboard and viewport
screenshots; check computed text/background contrast for tokens and focus
visible; React console errors fail test. No tests that only compare exact CSS
implementation.

Browser suite production test stack:

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm browser-tests npm run test:e2e -- e2e/components.spec.ts
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
git add -- 'apps/web/src/app/globals.css' 'apps/web/src/components/ui/button.tsx' 'apps/web/src/components/ui/field.tsx' 'apps/web/src/components/ui/dialog.tsx' 'apps/web/src/components/ui/status.tsx' 'apps/web/src/components/ui/data-view.tsx' 'apps/web/src/components/ui/ui.module.css' 'apps/web/src/components/ui/ui.test.tsx' 'apps/web/e2e/components.spec.ts' 'scripts/check-suites.json'
git commit -m 'feat(ui): add blue white accessible component system'
git push -u origin feature/m03-a
```

Judul PR: `[ARD-173] M03-A — Token visual dan komponen aksesibel`; body-file
memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** If layout needs new library or global redesign,
revise plan before installing. Do not accept desktop-only screenshot or
color-only status.

---

## M03-B — Navigasi mobile, login, setup dan akun

**Linear:**
[ARD-174](https://linear.app/ardani/issue/ARD-174/m03-b-navigasi-mobile-login-setup-dan-akun).
**Status:** Planned / Backlog. **Prasyarat:** M03-A. **Branch:**
`feature/m03-b`.

**Read set:**

- `docs/design/contracts.md`
- `apps/web/src/lib/api-client.ts`

**Write set (buat jika belum ada):**

- `apps/web/src/app/login/page.tsx`
- `apps/web/src/app/setup/page.tsx`
- `apps/web/src/app/account/password/page.tsx`
- `apps/web/src/app/(dashboard)/layout.tsx`
- `apps/web/src/components/navigation.tsx`
- `apps/web/src/components/session-provider.tsx`
- `apps/web/src/components/navigation.module.css`
- `apps/web/e2e/auth-navigation.spec.ts`
- `apps/web/src/app/api/app/setup/route.ts`
- `scripts/check-suites.json`

**Interfaces:** SessionProvider stores SessionDTO only in memory; useSession
returns loading/authenticated/anonymous; navigation permission matrix from
SessionDTO, backend remains authority. Setup maps native /init actions without
new account schema.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m03-b
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `apps/web/e2e/auth-navigation.spec.ts`. Assertion berikut adalah awal;
      skenario penerimaan langkah4 harus ditambahkan pada berkas tes write set.

```tsx
import { test, expect } from "@playwright/test";
test("operator mobile navigation omits global log and keeps status", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/login");
  await page.getByLabel("Nama pengguna").fill("operator");
  await page.getByLabel("Password", { exact: true }).fill("Fixture-Only-2026!");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Navigasi utama" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Log global", exact: true }),
  ).toHaveCount(0);
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm browser-tests npm run test:e2e -- e2e/auth-navigation.spec.ts
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Implement login fields Indonesian, busy/no duplicate submit, error
      generic+requestId, keyboard Enter, input
      autocompleteusername/current-password; success /overview.
- [ ] Dashboard layout server session fetch no-store; anonymous goes /login with
      allowlisted relative returnpath, expired401 clears state and reauth.
      Client permission refresh onfocus and interval30s, backend rechecks
      everyaction.
- [ ] Desktop sidebar, mobile bottomnav Ringkasan/Perangkat/Diagnosis/Lainnya,
      permissionbased links; modal mobile menu focusrestore. Route paths exact
      contracts; not-yetbuilt modules hidden via feature availability map until
      merged.
- [ ] Setup uses native initstatus/actions: no users installer path allowed only
      initial state; existingusers require native admin permissions. Do not
      expose public reset. Account password old/new/confirm, clear memory
      aftersuccess.
- [ ] Logout cancels fetches, clears forms/staging and memory, awaits backend
      cookieclear; cache cleanup hook prefix implemented M08-B. No
      token/localStorage.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M03-B mobile+desktop login/logout/8hexpiry, rolechange while pageopen,
permission403 directURL, setupfirst/alreadyinitialized,
selfpasswordwrong/correct. No clientconsoleerrors, no network requests to NBI or
externalCDN. Form secret absent from screenshots except maskedinput.

Expected browser: viewport relevan PASS, screenshot/report tersedia, console
error tak terduga gagal. Gunakan `../../artifacts/auth/admin.json` untuk admin,
operator.json untuk operator dan state kosong untuk anonymous; helper M02-A
membuatnya dari akun dummy. Path relatif cwd apps/web.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'apps/web/src/app/login/page.tsx' 'apps/web/src/app/setup/page.tsx' 'apps/web/src/app/account/password/page.tsx' 'apps/web/src/app/(dashboard)/layout.tsx' 'apps/web/src/components/navigation.tsx' 'apps/web/src/components/session-provider.tsx' 'apps/web/src/components/navigation.module.css' 'apps/web/e2e/auth-navigation.spec.ts' 'apps/web/src/app/api/app/setup/route.ts' 'scripts/check-suites.json'
git commit -m 'feat(web): add mobile navigation and native account flows'
git push -u origin feature/m03-b
```

Judul PR: `[ARD-174] M03-B — Navigasi mobile, login, setup dan akun`; body-file
memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** If native init API returns flags unknown to
renderer, preserve flag and show explicit unsupportedsetup error; do not
autoenable defaults. No deployment seeds from reference.

---

## M03-C — Status koneksi dan error boundary yang dapat didiagnosis

**Linear:**
[ARD-175](https://linear.app/ardani/issue/ARD-175/m03-c-status-koneksi-dan-error-boundary-yang-dapat-didiagnosis).
**Status:** Planned / Backlog. **Prasyarat:** M03-B. **Branch:**
`feature/m03-c`.

**Read set:**

- `docs/design/contracts.md`
- `apps/web/src/server/logger.ts`

**Write set (buat jika belum ada):**

- `apps/web/src/components/connection-status.tsx`
- `apps/web/src/components/connection-provider.tsx`
- `apps/web/src/components/error-reporter.tsx`
- `apps/web/src/app/error.tsx`
- `apps/web/src/app/global-error.tsx`
- `apps/web/src/app/api/app/health/route.ts`
- `apps/web/src/lib/connection-state.ts`
- `apps/web/src/lib/connection-state.test.ts`
- `apps/web/e2e/connection-errors.spec.ts`
- `scripts/check-suites.json`

**Interfaces:** reduceConnection(state,event): ConnectionState; online hint
never directly sets reachable. Three probe failures unavailable, one success
reachable; VPN state shown separately. captureClientError only whitelisted
fields.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m03-c
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `apps/web/src/lib/connection-state.test.ts`. Assertion berikut adalah
      awal; skenario penerimaan langkah4 harus ditambahkan pada berkas tes write
      set.

```tsx
import { test, expect } from "vitest";
import { reduceConnection } from "./connection-state";
test("VPN failure does not mark web offline", () => {
  const s = { app: "reachable", failedProbes: 0, vpn: "connected" } as const;
  expect(
    reduceConnection(s, { type: "vpn", state: "auth_failed" }),
  ).toMatchObject({ app: "reachable", vpn: "auth_failed" });
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M03-C
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Probe no-store /api/app/health every15s visible/tab focus, timeout2s, no
      paralleloverlap. Firstfailchecking, thirdfailunreachable; successful probe
      resetcounter. navigator offline triggers immediatechecking+probe, not
      finalstate.
- [ ] Header displays independent application/VPN/logging/per-device lastInform
      evidence with observedAt; VPN auth_failed wording asksadmincorrection, not
      reinstallPWA.
- [ ] ErrorBoundary generates safe code/requestId from server or client,
      retryread action and admintracecopy. window.onerror/unhandledrejection
      listener deduplicates samefingerprint60s, sanitizesURL/query/stack then
      POST client-errors.
- [ ] Browser unexpectedconsoleerror/pageerror/requestfailure fail relevant E2E
      unless explicitly expected injectedfailure is asserted. Mock outage in
      test route, not proxy restartproduction.
- [ ] Disable mutation when appunreachable/offline; preserve unsaved form memory
      and label stale memory. Backend403 not retried as networkerror.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M03-C falsepositive navigatoronLine, checking→unreachable→recover,
VPNdown+webup, sinkdown→buffering/degradedwarning, errorboundaryreport
exactlyonce and no secret marker. API unreachable + regained tabfocus triggers
refresh.

Browser suite production test stack:

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm browser-tests npm run test:e2e -- e2e/connection-errors.spec.ts
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
git add -- 'apps/web/src/components/connection-status.tsx' 'apps/web/src/components/connection-provider.tsx' 'apps/web/src/components/error-reporter.tsx' 'apps/web/src/app/error.tsx' 'apps/web/src/app/global-error.tsx' 'apps/web/src/app/api/app/health/route.ts' 'apps/web/src/lib/connection-state.ts' 'apps/web/src/lib/connection-state.test.ts' 'apps/web/e2e/connection-errors.spec.ts' 'scripts/check-suites.json'
git commit -m 'feat(diagnostics): separate connectivity states and capture errors'
git push -u origin feature/m03-c
```

Judul PR:
`[ARD-175] M03-C — Status koneksi dan error boundary yang dapat didiagnosis`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** If status combines VPN and app into onebool, stop
acceptance. Logging errors never recursively call client reporter unlimited.

---
