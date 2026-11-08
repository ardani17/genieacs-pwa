# Kontrak UI/UX shadcn/ui — revisi 4 November 2026

Status: perubahan kontrak diminta pengguna pada 4 November 2026, setelah
meninjau preview M04. Rencana ini dicatat sebelum refactor. Penyelesaian fungsi
M03–M04 sebelumnya tetap menjadi riwayat; migrasi visual berikut adalah scope
tambahan.

Pembaruan 9 November 2026 (penyelesaian adopsi, ARD-240…ARD-245): set primitive
kini lengkap — `AlertDialog`, `DropdownMenu`, `Checkbox`, dan `Textarea`
ditambahkan di `apps/web/src/components/ui` dan seluruh elemen mentah tersisa
(select/input/textarea/tabel hand-rolled pada device-list, log-search,
vpn/profile-form, admin/files, config-ui, admin/permissions) telah dimigrasikan
ke primitive bersama. Konfirmasi destruktif memakai AlertDialog dengan aksi
destruktif dan fokus awal pada tombol batal. DropdownMenu tersedia tanpa
konsumen paksaan karena belum ada aksi baris yang benar-benar meluap. Tabel
sr-only pada overview dipertahankan sebagai alternatif pembaca layar.

## Keputusan dan batas arsitektur

- Frontend tetap Next.js App Router, React dan TypeScript pada apps/web.
  shadcn/ui menjadi sumber komponen bersama yang disimpan sebagai source di
  repository.
- Fondasi styling berubah dari CSS Modules custom menjadi Tailwind CSS 4 dan CSS
  variables semantik. Gunakan satu keluarga primitive Radix untuk komponen
  interaktif dan Lucide untuk ikon lokal. Versi dependency diselesaikan dari
  sumber resmi, dikunci di package-lock, dan diperiksa advisory sebelum
  diterima.
- Komponen aplikasi memakai fondasi yang sama. CSS Modules lama dipindahkan atau
  dihapus setelah semua konsumennya dimigrasikan.
- Native session, Authorizer, BFF same-origin, filter, masking, CSV,
  correlation/requestId serta server-side NBI tetap mengikuti kontrak backend
  yang berlaku.
- State/fetch/AbortController tetap dipakai. Penambahan library form/query
  memerlukan kebutuhan tersendiri; migrasi ini berfokus pada UI.

## Tema dan token wajib

| Token                | Nilai   |
| -------------------- | ------- |
| background           | #F5F9FF |
| surface/card/popover | #FFFFFF |
| primary              | #1D4ED8 |
| primary hover        | #1E40AF |
| foreground           | #0F172A |
| muted foreground     | #475569 |
| border/input         | #CBD5E1 |
| success              | #166534 |
| warning              | #92400E |
| destructive          | #B91C1C |

Font system-ui lokal. Skala spacing 4/8/12/16/24/32 px; radius dasar 12 px;
kontrol interaktif/touch target minimal 44 px. Token shadcn seperti background,
foreground, card, primary, secondary, muted, accent, destructive, border, input
dan ring dipetakan ke tema ini. Focus ring terlihat dan status selalu memakai
teks/ikon.

Tipografi, padding, ukuran kontrol, border, shadow, radius, kepadatan tabel dan
pola judul/subjudul ditentukan di fondasi bersama. Warna makna dan variant
komponen dipakai konsisten di seluruh halaman.

## Komponen dan tanggung jawab

- Komponen dasar di apps/web/src/components/ui mengikuti source resmi shadcn/ui:
  Button, Input, Label/Field, Card, Badge, Alert, Dialog/AlertDialog, Select,
  Tabs, Table, Skeleton, Sheet, DropdownMenu, Separator dan Tooltip sesuai
  penggunaan nyata.
- Helper cn menggabungkan class secara konsisten. Komponen domain menyusun
  komponen dasar; business rules tetap pada fitur/server.
- Shared page header, section/card, form field, loading/empty/error/permission
  state, pagination dan status koneksi dipakai lintas layar.
- Label form terhubung ke input; pesan bantuan/error terhubung lewat ARIA.
  Busy/disabled mencegah kiriman ganda dan menjaga feedback yang jelas.
- Dialog/Sheet memakai focus trap, Escape dan pengembalian fokus yang benar.
  Menu, Select dan Tabs dapat digunakan dengan keyboard.
- Navigasi hanya menampilkan rute yang sudah tersedia dan sesuai permission.
  Aria-current menandai halaman aktif.

## Shell dan responsivitas

- Desktop: sidebar tetap, header halaman dan area konten dengan padding seragam.
  Header menyajikan status aplikasi/VPN/logging sebagai bukti yang terpisah.
- Mobile: topbar ringkas, bottom navigation untuk rute tersedia, dan Sheet
  Lainnya. Halaman perangkat memakai card dengan field dan aksi setara desktop.
- Lebar uji wajib 360×800, 768×1024 dan 1440×900. Halaman tidak overflow;
  tabel/parameter panjang memakai area scroll berlabel.
- Halaman yang sudah ada: login, setup, akun/password, overview, daftar
  perangkat, detail dan diagnosis baca. Link menuju modul yang belum
  diimplementasikan tetap mengikuti feature availability.

## Refactor M03

Migrasikan token, komponen dasar, navigasi, shell, login/setup/akun, status
koneksi dan error boundary. Pertahankan semantik sesi native delapan jam, server
permission, safe error dan requestId. Tidak ada token sesi atau data perangkat
persisten di browser.

## Refactor M04

- Overview: metric cards, ringkasan/visual data yang berlabel dan alternatif
  teks/tabel; klik segmen memakai filter yang sama pada daftar. Tampilkan
  source/waktu pengamatan serta count yang benar dari BFF.
- Daftar: satu filter toolbar, search, filter native, sort, pagination
  25/50/100, table desktop dan card mobile. URL tetap sumber state;
  count/list/CSV tetap memakai query dan permission yang sama.
- Detail: header identitas/status, tab konsisten, parameter browser, task/fault
  baca dan diagnosis. Masking terjadi sebelum browser. Kondisi
  unavailable/timeout/forbidden/empty ditampilkan jelas.
- WAN/WiFi/aksi M05 yang belum tersedia diberi status yang jujur. Refactor
  visual tidak mengaktifkan perintah perangkat baru.
- Preview memakai data sintetis yang diberi konteks demo, dengan representasi
  field native yang tepat agar total/filter/chart tidak memberikan angka palsu.

## Definition of Done

1. Seluruh halaman M03–M04 menggunakan token dan komponen bersama; pola button,
   field, dialog, table/card, tab dan status konsisten.
2. Semua state loading, empty, error, permission-denied, unavailable dan busy
   diuji; keyboard, focus restore, label dan touch target terjaga.
3. Parity sesi, permission/filter, pencarian literal/tag, sort, pagination,
   count, CSV/masking dan diagnosis baca tetap lulus.
4. Vitest/Testing Library dan Playwright dijalankan dengan fixture; screenshot
   visual diverifikasi pada tiga viewport. Hasil tes fungsi saja tidak menutup
   acceptance visual.
5. Lint, typecheck, format, production build dan artefak standalone lulus;
   dependency baru diperiksa dan dikunci.
6. Preview lokal diperbarui dari development sehingga pengguna dapat menilai
   hasil nyata. Evidence dan batas yang masih terbuka dicatat di Linear.
7. Refactor ini tidak menutup gate keamanan M01/ARD-206 atau mengubah keputusan
   PWA M08.

## Urutan pelaksanaan dan workflow

1. Catat kontrak dan tiket Linear; sinkronkan docs/design/contracts.md dan
   dokumen keputusan sebelum source UI diubah.
2. Bangun fondasi shadcn/theme lalu migrasikan komponen dan shell M03.
3. Migrasikan overview, daftar dan detail/diagnosis M04; jalankan acceptance.
4. Integrasikan commit ke development dan pertahankan checkout pengujian tunggal
   sesuai permintaan pengguna. Publikasi tetap melalui PR ke development; main
   tetap riwayat release.

## Sumber resmi

- https://ui.shadcn.com/docs
- https://ui.shadcn.com/docs/installation/next
- https://ui.shadcn.com/docs/installation/manual
- https://ui.shadcn.com/docs/theming
