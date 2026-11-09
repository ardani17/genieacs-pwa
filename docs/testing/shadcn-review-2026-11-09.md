# Review hasil plan shadcn/ui — 9 November 2026

Scope: `git diff e858410...c9b7c64`, seluruh paket A–E adoption completion dan
koreksi/evidence PR #17–18. Seluruh PR tersebut sudah masuk development sebelum
review ini. Review memakai dua pemeriksaan independen berikut.

## Standards

1. **P1 — draft resource lain dapat hilang.** Action menutup dialog sebelum
   DELETE selesai. Reproduksi Chromium dengan respons ditahan: hapus A, buka B,
   edit B, selesaikan DELETE A; callback mengosongkan editor dan draft B.
   Melanggar kontrak busy/disabled dan feedback pada `ui-design-system.md`.
2. **P2 — fokus keyboard hilang setelah batal.** Dialog permission dibuka lewat
   state tanpa Trigger atau pemulihan fokus. Klik Hapus lalu Escape menempatkan
   fokus di BODY; Tab kembali ke navigasi awal. Melanggar pengembalian fokus
   dialog dalam kontrak UI.

Standards: dua temuan; terburuk kehilangan draft belum disimpan.

## Spec

1. **P2 — konfirmasi async menutup sebelum hasil server.** Pada users,
   resource-editor dan files, Action menjalankan penutupan default Radix;
   kegagalan kehilangan target retry. Melanggar “Feature behavior, permissions
   and endpoints stay identical”. Ini akar masalah yang sama dengan temuan draft
   pada Standards.
2. **P2 — penghapusan file dikunci oleh status upload.** `disabled={uploading}`
   tidak mengikuti DELETE. Konfirmasi berulang dapat mengirim permintaan ganda,
   melanggar “busy/disabled prevents double submits”.

Spec: dua temuan; terburuk penutupan konfirmasi async sebelum selesai.

## Perbaikan dan reproduksi

- Empat konfirmasi admin kini menahan penutupan default Action, menjaga target
  sampai berhasil, menolak dismiss/submit saat busy, dan menampilkan error di
  dalam modal. Files memiliki status deletion sendiri dan menangani kegagalan
  jaringan; permission juga menangani kegagalan jaringan.
- Primitive AlertDialog mengingat elemen pembuka dan memulihkan fokus jika
  elemennya masih terpasang; callback autofocus pemanggil tetap dihormati.
- Lima tes konsumen nyata gagal sebelum perbaikan, lalu lulus: DELETE tertunda,
  penolakan403, retry ke target sama, klik ganda, Escape, dan file offline. Tes
  pemulihan fokus tanpa Trigger juga gagal sebelum perbaikan, lalu lulus.
- Command regresi:
  `npm run test --prefix apps/web -- src/features/admin/delete-confirmation.test.tsx src/components/ui/ui.test.tsx`.
  Hasil setelah perbaikan: **19/19 lulus**.
- Kedua reviewer memeriksa diff perbaikan dan tidak menemukan masalah blocking
  tambahan. Endpoint, izin, dependency dan semantik dispatch perintah perangkat
  tetap mengikuti implementasi sebelumnya.

Dialog reset bootstrap VPN tetap berupa form berkonfirmasi literal `RESET` dan
revision pada alur M07, sama seperti form reset-password yang tetap memakai
Dialog. Tidak ada perubahan alur reset pada perbaikan regresi admin ini.

## Verifikasi keseluruhan

Pemeriksaan berjalan melalui image Node24.22.2 dan database fixture terisolasi.
`prettier --check .` pertama menemukan file lokal untracked di `.zcode/`;
pemeriksaan ulang mengecualikan hanya directory tersebut, tanpa mengubahnya.
Hasil lengkap dicatat pada PR perbaikan; log lokal berada di ignored
`artifacts/review/`. Kredensial VPN dan data perangkat tidak masuk Git.

- Prettier (pengecualian `.zcode/` lokal), ESLint backend/frontend dan
  TypeScript backend/frontend: lulus.
- Unit backend: **133/133**; unit frontend: **121/121**.
- Build produksi backend dan frontend: lulus, empat executable engine, aset
  JS/CSS dan standalone server terverifikasi.
- Playwright `admin-config`, `admin-users-files`, `device-commands`: **63/63
  lulus**, mencakup360×800,768×1024,1440×900 pada stack engine/BFF fixture
  terpisah dari preview.
- Lockfile tidak berubah; `git diff --check` bersih.
