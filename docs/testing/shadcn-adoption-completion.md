# Bukti pengujian — penyelesaian adopsi shadcn/ui (ARD-240…ARD-245)

Tanggal: 8–9 November 2026. Baseline `development` sebelum pekerjaan: `e858410`.
Semua paket dieksekusi di container `tooling` (Node 24.22.2, `compose.dev.yaml`)
dan diverifikasi CI GitHub pada tiap PR ke `development`.

## Ringkasan paket

| Paket                                                            | Issue   | PR  | Status       |
| ---------------------------------------------------------------- | ------- | --- | ------------ |
| Planning doc                                                     | ARD-240 | #11 | Merged       |
| A — primitives (checkbox, textarea, alert-dialog, dropdown-menu) | ARD-241 | #12 | Merged, Done |
| B — migrasi kontrol form                                         | ARD-242 | #14 | Merged, Done |
| C — migrasi tabel                                                | ARD-243 | #13 | Merged, Done |
| D — AlertDialog konfirmasi destruktif                            | ARD-244 | #15 | Merged, Done |
| E — wrap-up dokumen/evidence                                     | ARD-245 | #16 | Merged, Done |

## Evidence lokal per paket (tooling container)

- A (commit `05193b9` + `9bc361e`): lint pass, typecheck pass, Vitest
  **114/114** (109 existing + 5 baru), `next build` + standalone `server.js`
  ada, lockfile tidak berubah.
- B (rebase di atas A+C): lint pass, typecheck pass, Vitest **25 file/114 test**
  (run penuh; satu run parsial 16 file dibuang sebagai flake worker bind-mount
  dan diulang hingga run penuh), build + standalone pass, prettier pass.
- C: lint/typecheck/Vitest/build + standalone pass; prettier pass pada kedua
  file; `git diff` lockfile kosong.
- D: lint/typecheck pass (juga setelah rebase di atas B), Vitest **25 file / 115
  test** (24 file = 111 test pada run utama + `wan-editor.test.tsx` 4/4
  dijalankan terpisah setelah satu worker gagal start karena flake bind mount),
  build + standalone pass, prettier pass. Catatan DDL: penghapusan permission
  kini meminta konfirmasi (penambahan perilaku sesuai kontrak).

## Catatan lingkungan

- Dua run Vitest parsial (16 file dan 22/24 file) terjadi karena "Failed to
  start forks worker ... Timeout waiting for worker to respond" pada bind mount
  node_modules Docker Desktop — fenomena yang sama dengan komentar pada
  `apps/web/vitest.config.ts`. Keduanya diulang sampai run penuh; tidak ada test
  yang gagal karena perubahan kode.
- Dua job `packages` CI gagal sekali karena flake infrastruktur log
  (`pipeline.smoke` "event not searchable within budget" dan "service:ui
  events"); keduanya lolos pada rerun tanpa perubahan kode, dan tidak terkait PR
  UI (kegagalan terjadi juga di luar file yang diubah).

## Spot-check pasca-merge (9 November 2026)

Item "verifikasi visual manual pasca-merge" di bawah dijalankan setelah seluruh
PR ter-merge, pada stack preview lokal yang di-build ulang dari `development`
`9426a64` (`compose.test.yaml` + `compose.e2e.yaml` +
`artifacts/review/preview.yaml`, proyek `genieacs-pwa-preview`, web di
`127.0.0.1:5300`, fixture engine + seed). Login sebagai `admin` fixture lewat
form login sungguhan.

### Navigasi keyboard dan perilaku (PASS)

- **Select Level** (`/diagnostics/logs`): Space membuka listbox (5 opsi),
  ArrowDown + Enter mengubah nilai "Semua level" → "debug", buka-ulang dengan
  Space, dan Escape menutup. Diverifikasi lewat KeyboardEvent bubbling karena
  input nyata tidak dapat dikirim browser in-app pada sesi ini (lihat catatan
  lingkungan di bawah).
- **AlertDialog hapus pengguna** (`/admin/users`): dialog terbuka dengan
  `role="alertdialog"` + `aria-modal="true"`, fokus awal jatuh pada tombol
  **Batal** (safe default), Escape menutup dialog dan baris `operator` tetap ada
  (tidak terhapus).
- **Checkbox pilih perangkat** (`/devices`): `aria-checked` berubah `true` saat
  diaktifkan, action bar bulk muncul ("1 dipilih", input "Tag untuk bulk",
  tombol Tambah/Hapus tag disabled sampai diisi) dan menghilang saat seleksi
  dilepas.

### Visual tiga viewport (PASS, tanpa temuan blocking)

Halaman yang berubah (devices, settings/vpn, admin/permissions, admin/config,
admin/files, diagnostics/logs) ditangkap pada 360×800, 768×1024, dan 1440×900
lalu diaudit visual. Tidak ada overflow, tumpang-tindih, atau teks terpotong
yang blocking. Catatan:

- Scroll horizontal region tabel perangkat pada 768px adalah perilaku kontrak
  (tabel di-scroll dalam region berlabel), bukan defect.
- Tabel permission tanpa baris header terverifikasi **pre-existing**: struktur
  pra-migrasi (`e3411ed~1`) juga tanpa `<thead>`; migrasi ARD-243 setia pada
  struktur asli. Dicatat sebagai polish terpisah, bukan regresi.
- Teks nilai select "Tipe file" (`admin/files`) dapat terpotong pada lebar 768
  ("1 Firmware Upgra…"); minor, dicatat sebagai polish terpisah.
- Satu laporan "clipping" dari audit visual pada halaman log desktop dibantah
  pengukuran DOM: `scrollWidth === clientWidth === 1425`, nol elemen melewati
  viewport, combobox Level utuh (left 840 → right 1368).

### Catatan lingkungan spot-check

Browser in-app pada sesi ini tidak dapat mengirim event pointer/keyboard nyata
ke halaman (klik tombol login timeout; keylogger capture-phase kosong setelah
keypress CDP). Karena itu interaksi diverifikasi dengan klik/form-submit
programatik + KeyboardEvent bubbling + asersi DOM. Cakupan input nyata dipegang
job e2e CI — lihat koreksi di bawah.

### Koreksi pasca-pelaporan: regresi e2e Paket D ditemukan dan diperbaiki

Draf pertama section ini mengklaim e2e CI "hijau untuk #12–#16". Verifikasi
lanjutan (rerun e2e PR #17 gagal dua kali dengan signature identik) membuktikan
klaim itu keliru:

- **PR #15 (Paket D): job e2e FAIL** (21 failed / 129 passed, 38.2m) — lima
  konfirmasi destruktif dirender `role="alertdialog"` oleh `f3a4a86`, tetapi
  spec `admin-config`/`admin-users-files` masih menunggu `getByRole("dialog")`
  (role Playwright di-match eksak). PR tetap ter-merge karena status salah
  dibaca sebagai hijau.
- **PR #16: job e2e "pass" dalam 4m50s** — suite (normalnya ~38m) tidak berjalan
  penuh; kegagalan regression tidak tertangkap.
- Perbaikan: 8 locator konfirmasi hapus diperbarui ke `alertdialog` (locator
  reset-password tetap `dialog` — komponennya memang Dialog biasa). Validasi
  pada stack check lokal (konfigurasi identik CI): **14/14 test kedua file spec
  lulus (36.9s)**, termasuk seluruh alur yang tadinya gagal. Fix di PR #18.
- Pelajaran proses: status PR harus dibaca ulang menjelang merge (e2e adalah job
  terlama dan datang terakhir); "pass" dengan durasi anomali pendek perlu
  diperlakukan sebagai tidak-terverifikasi.

## Batas yang tetap terbuka

- ~~Spot-check visual tiga viewport~~ — selesai 9 November 2026 (section di
  atas). Cakupan input nyata tetap pada e2e CI.
- M01/ARD-206, M07-D/ARD-190, M08 PWA, dan M09 tetap di luar scope ini.
