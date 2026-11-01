# Standar paket kerja untuk agen low-thinking

Pengguna meminta sesi ini menghasilkan dokumen dan rencana lengkap saja.
Implementasi fitur dilakukan kemudian oleh agen lain. Dokumen ini menetapkan
mutu rencana dan mekanisme eksekusi; bukan perintah untuk mulai membangun.

## Bentuk dokumen akhir

- Indeks milestone M00 sampai M09: urutan, dependensi, tiket Linear, branch/PR,
  gate, dan tautan paket kerja.
- Kontrak bersama: data/API, session/permission, profil perangkat/VPN,
  error/log, dan mode cache yang sudah disepakati.
- Satu bagian berjudul ID untuk setiap paket perubahan yang dapat diuji dan
  diperiksa mandiri, dikelompokkan dalam dokumen milestone dan satu dokumen
  keamanan tambahan. Agen membaca hanya bagian paket yang dipilih serta read
  set-nya melalui indeks/ tiket, tanpa menelusuri seluruh repo atau memilih
  arsitektur sendiri.
- Fixture aman dan bukti patch yang dapat diakses tanpa deployment referensi,
  kredensial nyata, atau percakapan lama.
- Jalur file, identifier tiket/branch, versi dependency, command, expected
  output, dan batas perubahan bernilai konkret pada paket Ready.
  Template/placeholder tidak dianggap instruksi eksekusi siap pakai.

## Isi wajib setiap paket

1. ID paket/tiket, milestone, status kesiapan, dan tujuan yang dapat dinilai
   lulus/gagal.
2. Prasyarat berupa paket/PR yang sudah selesai dan file/kontrak yang tersedia,
   berikut cara memeriksa setiap prasyarat.
3. Read set: file yang benar-benar perlu dibaca sebelum bekerja.
4. Write set exact: file yang boleh dibuat/diubah, test dan dokumentasi yang
   diperbarui, serta tanggung jawab setiap file.
5. Input/output: signature atau skema lengkap, enum, error, dan fixture. Nama
   yang dipakai paket lain berasal dari kontrak bersama.
6. Checklist aksi kecil berurutan, satu aksi per langkah. Langkah kode memuat
   implementasi atau algoritma konkret; langkah tes memuat skenario, command,
   dan hasil yang harus terlihat.
7. Pemisahan kegagalan tes yang sengaja diharapkan sebelum implementasi dari
   kegagalan tak terduga yang harus dihentikan dan dilaporkan.
8. Perilaku sukses, validasi gagal, permission ditolak, dependency putus,
   timeout, hasil parsial, dan hasil belum terkonfirmasi yang relevan.
9. Event log, korelasi, redaksi, serta pengujiannya.
10. Command pemeriksaan akhir, expected result, dan bukti UI/artefak untuk PR.
11. Stop conditions dan prosedur pemulihan khusus untuk paket tersebut.
12. Pesan commit, judul/base PR, format hasil, dan pembaruan status Linear yang
    konkret.

## Gate Ready

Paket hanya Ready jika keputusan yang memengaruhinya sudah dikunci, kontrak dan
fixture tersedia, semua dependency jelas, dan tidak ada langkah yang meminta
agen memilih sendiri desain, library, path, schema, default konfigurasi, atau
definisi selesai. Review dokumen memeriksa konsistensi nama, signature, dan enum
antar-paket serta cakupan acceptance setiap kebutuhan.

Selama wawancara terbuka, milestone/tiket implementasi tetap backlog.
Ketidakpastian dicatat pada daftar keputusan, bukan disembunyikan dalam paket
yang diberi label siap dikerjakan.

## Protokol kerja agen pelaksana

1. Baca aturan repo, paket, serta read set-nya. Periksa status Git, branch,
   remote fork, dependency dan status Ready sebelum mengedit.
2. Gunakan branch fitur yang ditentukan dari development yang memuat seluruh
   prasyarat. Perubahan tak dikenal dalam worktree dipertahankan dan dilaporkan.
3. Jalankan tes awal yang dicantumkan. Kegagalan di luar kondisi awal paket
   dihentikan dan dicatat sebelum kode baru ditambahkan.
4. Kerjakan satu langkah lalu verifikasi hasilnya. Ubah hanya write set.
   Signature/dependency di luar paket memerlukan revisi rencana, bukan
   improvisasi agen pelaksana.
5. Jalankan seluruh pemeriksaan. Jangan melemahkan assertion, mengabaikan error,
   menurunkan CI, atau menganggap exit code sukses sebagai bukti bila
   artefak/hasil sebenarnya tidak sesuai.
6. Periksa diff dan redaksi secret, lalu commit/push branch serta buka PR sesuai
   paket setelah acceptance terbukti. Main tetap jalur release.
7. Catat bukti dan PR pada tiket. In Review berarti menunggu pemeriksaan; Done
   memerlukan acceptance dan penggabungan yang memang sudah selesai.

## Kondisi berhenti

- Kontrak/prasyarat belum tersedia, paket belum Ready, atau instruksi saling
  bertentangan.
- Perubahan memerlukan file, schema, dependency, permission, atau perilaku di
  luar write set.
- Tes gagal dengan penyebab yang tidak dijelaskan dan tidak dapat diperbaiki
  dalam lingkup langkah yang diberikan.
- Verifikasi membutuhkan host, kredensial, perangkat uji, domain/certificate,
  atau layanan yang belum disediakan. Laporkan input yang hilang tanpa menebak
  atau mengambilnya dari deployment referensi.
- Command menyentuh volume, container, jaringan, database, atau perangkat di
  luar project uji yang ditentukan.

Simpan perubahan yang aman, laporkan langkah terakhir dan bukti error yang
disamarkan, lalu kembalikan tiket untuk revisi rencana. Kegagalan satu paket
tidak otomatis mengizinkan perubahan lintas arsitektur atau tahap lain.

## Batas pengujian dan akses

Paket menyebut project Compose, port, volume dan fixture uji secara eksplisit.
Tes otomatis mengarah ke stack/fixture tersebut. Perangkat atau akun VPN
produksi dan direktori GenieACS referensi bukan default target uji. Pengujian
live memerlukan input lingkungan uji yang ditentukan. Hasil simulasi tidak
dilaporkan sebagai keberhasilan perangkat nyata.

## Bukti handoff

Hasil agen berisi ID paket/tiket, branch/commit, file yang diubah, command dan
hasilnya, bukti acceptance, ID korelasi log yang relevan, PR, serta keterbatasan
atau prasyarat tersisa. Password, token, cookie, raw log sensitif, dan data
pelanggan nyata tidak dimasukkan dalam bukti.
