# Compact Responsive UI Implementation Plan

> **For agentic workers:** Execute this approved plan inline, task by task.

**Goal:** Membuat UI ringkas dan membatasi lebar konten dengan target sentuh
mobile yang tetap nyaman.

**Architecture:** Ukuran kontrol berasal dari CSS variables bersama yang berubah
pada viewport minimal 768 px dengan pointer presisi. Komponen shadcn dan
komponen fitur mengonsumsi token yang sama; shell dan toolbar menyesuaikan lebar
layar.

**Tech Stack:** Next.js, React, shadcn/ui, Radix, Tailwind CSS 4, Playwright.

## Global Constraints

- Kontrol 44 px secara default dan pada perangkat sentuh.
- Desktop presisi: default 36 px, sm 32 px, xs 28 px dan lg 40 px.
- Input pada perangkat sentuh tetap 16 px.
- Konten dashboard maksimal 1024 px; sidebar muncul mulai 1024 px.
- Pertahankan fungsi, permission dan seluruh API; tidak menambah dependency.

## Task 1: Fondasi dan konsumen ukuran

- [x] Tambahkan token `--control-height`, `--control-height-sm`,
      `--control-height-xs`, `--control-height-lg` dan `--checkbox-hit-inset` di
      `apps/web/src/app/globals.css`; ubah nilainya pada
      `@media (min-width: 48rem) and (pointer: fine)`.
- [x] Gunakan `h-(--control-height)` pada Input/Button, ukuran sm/xs/lg pada
      button variants dan Select; gunakan `min-h-(--control-height-sm)` pada
      link, tab dan item menu. Pertahankan tinggi sentuh melalui nilai default
      token. Tengah-tengahkan ikon pencarian dengan `top-1/2 -translate-y-1/2`.
- [x] Ringkas Card ke `gap-4 py-4` dan `px-4`; PageHeader ke
      `text-xl md:text-2xl`; tabel ke `px-3 py-2 md:py-1`. Ringkas status, auth,
      gap fitur, judul detail dan angka overview tanpa mengubah handler.

## Task 2: Shell dan susunan konten

- [x] Ubah `components/navigation.tsx` ke sidebar `w-56 lg:flex`, navigasi
      mobile `lg:hidden`, gap/padding kecil dan area sidebar yang dapat
      discroll.
- [x] Ubah dashboard layout ke `lg:ml-56`, padding 16–24 px dan konten
      `max-w-5xl space-y-4`. Form filter memakai
      `grid-cols-2 xl:grid-cols-[minmax(0,1fr)_auto_auto]` dan pencarian
      `col-span-2 xl:col-span-1`; filter lanjutan memakai `basis-40` agar tombol
      Terapkan muat sebaris di mobile.
- [x] Sinkronkan `docs/design/ui-design-system.md` dengan rancangan ini.

## Task 3: Validasi perilaku dan visual

- [x] Di `apps/web/e2e/ui-contract.spec.ts`, ukur kontrol dengan boundingBox: 36
      px untuk desktop presisi, 44 px untuk mobile/sentuh; ukur baris perangkat
      maksimal 44 px pada desktop, konten maksimal 1024 px pada layar lebar,
      serta verifikasi menu tablet terbuka dan kembali fokus saat Escape.
- [x] Jalankan Prettier, ESLint, TypeScript dan unit tests untuk apps/web.
      Bangun image produksi dengan `docker build -f docker/web/Dockerfile`.
- [x] Jalankan Playwright pada fixture preview, periksa screenshot halaman utama
      di tiga viewport dan layout tambahan pada 1920 px serta layar pendek.
      Simpan screenshot hanya di `artifacts/` yang diabaikan Git.

## Hasil verifikasi

- Format semua file yang diubah, ESLint dan TypeScript lulus. Tooling dan build
  produksi memakai Docker Node 24.22.2 yang dikunci di repository.
- Vitest: 26 file, 121 test lulus.
- Playwright: 48 test lulus pada konfigurasi 360×800, 768×1024 dan 1440×900,
  termasuk layar sentuh besar, keyboard/fokus, filter, CSV dan masking.
- Audit layout 16 halaman pada tiga viewport: tidak ada overflow halaman.
  Pemeriksaan tambahan lebar 320 px juga tidak overflow.
- Baris perangkat desktop terukur 40.5–41 px (sebelumnya sekitar 61 px); filter
  mobile 263 px (sebelumnya 435 px); kontrol desktop 36 px dan mobile/sentuh 44
  px. Konten desktop dibatasi 1024 px.
- Screenshot diperiksa pada login, perangkat, detail, admin dan VPN; artefak
  lokal disimpan di `artifacts/ui-density-audit/` yang diabaikan Git.
- Image produksi `genieacs-pwa-review-web:compact-ui` berhasil dibangun dan
  preview lokal port 5300 telah diperbarui.
