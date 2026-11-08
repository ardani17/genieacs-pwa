# Bukti pengujian — penyelesaian adopsi shadcn/ui (ARD-240…ARD-245)

Tanggal: 8–9 November 2026. Baseline `development` sebelum pekerjaan: `e858410`.
Semua paket dieksekusi di container `tooling` (Node 24.22.2, `compose.dev.yaml`)
dan diverifikasi CI GitHub pada tiap PR ke `development`.

## Ringkasan paket

| Paket                                                            | Issue   | PR     | Status                                                       |
| ---------------------------------------------------------------- | ------- | ------ | ------------------------------------------------------------ |
| Planning doc                                                     | ARD-240 | #11    | Merged                                                       |
| A — primitives (checkbox, textarea, alert-dialog, dropdown-menu) | ARD-241 | #12    | Merged, Done                                                 |
| B — migrasi kontrol form                                         | ARD-242 | #14    | Merged, Done                                                 |
| C — migrasi tabel                                                | ARD-243 | #13    | Merged, Done                                                 |
| D — AlertDialog konfirmasi destruktif                            | ARD-244 | #15    | PR terbuka saat catatan ini ditulis; evidence lokal di bawah |
| E — wrap-up dokumen/evidence                                     | ARD-245 | PR ini | —                                                            |

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

## Batas yang tetap terbuka

- Spot-check visual tiga viewport (360×800, 768×1024, 1440×900) pada halaman
  yang berubah mengandalkan job e2e CI (Playwright + fixture engine) karena
  preview lokal tidak dijalankan ulang pada sesi ini; e2e CI lulus untuk
  #12/#13/#14. Verifikasi visual manual pasca-merge tetap disarankan sebelum
  rilis (M09).
- M01/ARD-206, M07-D/ARD-190, M08 PWA, dan M09 tetap di luar scope ini.
