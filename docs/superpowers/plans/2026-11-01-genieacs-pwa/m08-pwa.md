# M08 — PWA dan cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.
>
> Sesi ini hanya dokumentasi. Paket berstatus Planned; eksekusi hanya ketika
> prasyarat merged, desain ditinjau dan tiket pelaksanaan dipilih. Agen
> low-thinking mengambil satu paket/PR, bukan seluruh milestone sekaligus.

**Goal:** PWA dan cache dengan acceptance tiap paket yang dapat ditinjau
mandiri.

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

## M08-A — Manifest, aset lokal dan mode instalasi

**Linear:**
[ARD-191](https://linear.app/ardani/issue/ARD-191/m08-a-manifest-aset-lokal-dan-mode-instalasi).
**Status:** Planned / Backlog. **Prasyarat:** M07-D. **Branch:**
`feature/m08-a`.

**Read set:**

- `docs/design/contracts.md`
- `apps/web/next.config.ts`

**Write set (buat jika belum ada):**

- `apps/web/src/app/manifest.ts`
- `apps/web/public/icons/icon-192.png`
- `apps/web/public/icons/icon-512.png`
- `apps/web/public/icons/maskable-512.png`
- `apps/web/public/offline.html`
- `apps/web/public/offline.css`
- `apps/web/src/components/install-prompt.tsx`
- `apps/web/src/app/layout.tsx`
- `apps/web/e2e/pwa-install.spec.ts`
- `scripts/check-suites.json`

**Interfaces:** Manifeststandalone/start_url/overview/themesexactcontracts;
InstallPrompt securecontextfeaturedetect, HTTPIPmodeweb explanatorymessage.
Offlinepage generic no user/device fields.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m08-a
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `apps/web/e2e/pwa-install.spec.ts`. Assertion berikut adalah awal;
      skenario penerimaan langkah4 harus ditambahkan pada berkas tes write set.

```tsx
import { test, expect } from "@playwright/test";
test("manifest contains local install assets", async ({ request }) => {
  const r = await request.get("/manifest.webmanifest");
  const m = await r.json();
  expect(m.display).toBe("standalone");
  expect(m.theme_color).toBe("#1D4ED8");
  expect(
    m.icons.some((x) => x.sizes === "512x512" && x.purpose === "maskable"),
  ).toBe(true);
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm browser-tests npm run test:e2e -- e2e/pwa-install.spec.ts
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Manifest Next standalone memakai start_url/overview, theme sesuai kontrak
      dan ikon lokal192/512/maskable. Aset dibuat dari logo SVG lokal dan PNG
      deterministik saat build.
- [ ] Offline HTML/CSS mandiri hanya memuat ikon, penjelasan cache tampilan dan
      retry. Tidak mengandung nama pengguna, ONT atau data persisten.
- [ ] Install prompt memeriksa secure context, browser support dan standalone.
      HTTP IP LAN tetap web biasa; browser tanpa prompt mendapat petunjuk manual
      yang tepat.
- [ ] HTTPS membutuhkan cert trusted sesuai deployment. Uji HTTPS
      terpercaya/localhost serta HTTP IP ordinary web tanpa menonaktifkan
      keamanan browser.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

M08-A manifest/iconsresolution/maskablesafezone/startURL; offlinepage
containsnostoreddevice; webHTTPworks no insecureSWconsoleerror;
Chromiuminstallability and manualiOSAddToHomescreen instructionschecked.
Simulatornotclaimallbrowsersinstalled.

Expected browser: viewport relevan PASS, screenshot/report tersedia, console
error tak terduga gagal. Gunakan `../../artifacts/auth/admin.json` untuk admin,
operator.json untuk operator dan state kosong untuk anonymous; helper M02-A
membuatnya dari akun dummy. Path relatif cwd apps/web.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'apps/web/src/app/manifest.ts' 'apps/web/public/icons/icon-192.png' 'apps/web/public/icons/icon-512.png' 'apps/web/public/icons/maskable-512.png' 'apps/web/public/offline.html' 'apps/web/public/offline.css' 'apps/web/src/components/install-prompt.tsx' 'apps/web/src/app/layout.tsx' 'apps/web/e2e/pwa-install.spec.ts' 'scripts/check-suites.json'
git commit -m 'feat(pwa): add installable manifest and offline shell assets'
git push -u origin feature/m08-a
```

Judul PR: `[ARD-191] M08-A — Manifest, aset lokal dan mode instalasi`; body-file
memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** If HTTPScertificate unavailable,
keepwebmodeandrecordmanualHTTPSgate; no blanketbrowsersecuritydisable. No
publiccertificateissuance duringautomatedtests.

---

## M08-B — Service worker allowlist, offline icon dan update aman

**Linear:**
[ARD-192](https://linear.app/ardani/issue/ARD-192/m08-b-service-worker-allowlist-offline-icon-dan-update-aman).
**Status:** Planned / Backlog. **Prasyarat:** M08-A. **Branch:**
`feature/m08-b`.

**Read set:**

- `docs/design/contracts.md`
- `apps/web/src/components/session-provider.tsx`

**Write set (buat jika belum ada):**

- `apps/web/scripts/build-precache.mjs`
- `apps/web/public/sw.js`
- `apps/web/src/components/service-worker.tsx`
- `apps/web/src/components/update-banner.tsx`
- `apps/web/src/components/session-provider.tsx`
- `apps/web/next.config.ts`
- `apps/web/package.json`
- `apps/web/e2e/pwa-cache.spec.ts`
- `scripts/check-suites.json`

**Interfaces:** buildPrecache(buildDir):assetURLs[] immutablebuildallowlist;
worker cacheNamegenieacs-shell-appVersion-commit; clearAppCaches prefixonly;
update waitsform/taskcompletion.

### Langkah

- [ ] **1. Periksa prasyarat, baseline dan branch.** Ikuti preflight indeks;
      dependency harus merged dan baseline check lulus. Setelah development
      diperbarui:

```sh
git switch -c feature/m08-b
```

- [ ] **2. Tambahkan tes perilaku pertama** pada
      `apps/web/e2e/pwa-cache.spec.ts`. Assertion berikut adalah awal; skenario
      penerimaan langkah4 harus ditambahkan pada berkas tes write set.

```tsx
import { test, expect } from "@playwright/test";
test("cache contains only generic assets and offline page", async ({
  page,
  context,
}) => {
  await page.goto("/overview");
  await page.evaluate(() => navigator.serviceWorker.ready);
  const urls = await page.evaluate(async () => {
    const keys = await caches.keys();
    const out: string[] = [];
    for (const k of keys)
      for (const r of await (await caches.open(k)).keys()) out.push(r.url);
    return out;
  });
  expect(urls.some((u) => /\/api\/|_rsc|devices\/|logs\//.test(u))).toBe(false);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText("Tampilan tersimpan.", { exact: false }),
  ).toBeVisible();
});
```

- [ ] **3. Lihat red yang dimaksud, lalu kerjakan perubahan berurutan.** Modul
      baru boleh gagal karena belum tersedia; perubahan existing harus gagal
      pada assertion perilaku yang akan diperbaiki. Error lingkungan/dependency
      bukan red yang boleh diabaikan.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm browser-tests npm run test:e2e -- e2e/pwa-cache.spec.ts
```

Expected sesudah perubahan: semua assertion suite PASS dan artifact wajib
tersedia.

**Urutan perubahan:**

- [ ] Build precache mengambil hash asset .next/static dan fixed
      offline/icon/CSS. Tolak API/auth/RSC/HTML private; inject allowlist, versi
      dan commit ke worker.
- [ ] Fetch handler hanya GET same-origin asset exact allowlist. Navigasi
      network-only dengan offline HTML fallback;
      API/RSC/CSV/log/file/login/session tidak disimpan.
- [ ] Halaman aktif terputus memberi label data memory belum diperbarui dan
      menonaktifkan mutation. Cold reload hanya offline generik; VPN down dengan
      app reachable tidak diberi label offline cache.
- [ ] Registrasi hanya secure context, updateViaCache:none. Waiting worker
      memberi banner; reload menunggu persetujuan pengguna dan tidak ada dirty
      form/task in-flight. Aktivasi membersihkan cache versi lama prefix
      sendiri.
- [ ] Logout menghapus state/fetch/staging/form/cache prefix. Akun berikutnya
      tidak melihat data memory lama. Reconnect mengambil session dan halaman
      fresh dengan permission terkini.

- [ ] **4. Jalankan acceptance positif/negatif dan pemeriksaan log.** Daftarkan
      command konkret pada scripts/check-suites.json; runner exit nonzero saat
      gagal dan menolak hasil/artifact kosong.

Periksa CacheStorage, IndexedDB dan localStorage: tidak ada data
device/token/secret. Uji logout/ganti akun/cold offline/API503/update dirty
form/task in-flight dan VPN state terpisah. Jalankan pada production build; dev
server bukan bukti service worker release.

Expected browser: viewport relevan PASS, screenshot/report tersedia, console
error tak terduga gagal. Gunakan `../../artifacts/auth/admin.json` untuk admin,
operator.json untuk operator dan state kosong untuk anonymous; helper M02-A
membuatnya dari akun dummy. Path relatif cwd apps/web.

- [ ] **5. Periksa diff lalu kirim satu PR ke development.** Jalankan check
      akhir pada indeks, verifikasi redaksi/evidence/write set. Commit hanya
      file paket:

```sh
git diff --check
git add -- 'apps/web/scripts/build-precache.mjs' 'apps/web/public/sw.js' 'apps/web/src/components/service-worker.tsx' 'apps/web/src/components/update-banner.tsx' 'apps/web/src/components/session-provider.tsx' 'apps/web/next.config.ts' 'apps/web/package.json' 'apps/web/e2e/pwa-cache.spec.ts' 'scripts/check-suites.json'
git commit -m 'feat(pwa): enforce static-only cache and controlled updates'
git push -u origin feature/m08-b
```

Judul PR:
`[ARD-192] M08-B — Service worker allowlist, offline icon dan update aman`;
body-file memuat hasil dan verifikasi. Tiket In Review setelah PR, Done setelah
acceptance+merge. Ikuti format handoff indeks; jangan menerbitkan tag saat PR
biasa.

**Stop / pemulihan khusus:** Anyprivatepayloadcacheisreleaseblocker.
Ifprecachecannotprovestaticallowlist, stopSWactivation; ordinarywebstillworks.
Rollbackworkerremovescacheprefixwithoutdeletingothersites.

---
