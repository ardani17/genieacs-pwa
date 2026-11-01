# Kesetaraan fitur dan patch ACS referensi

Pemeriksaan read-only pada 1 November 2026. Dokumen ini merupakan inventaris dan
kriteria penerimaan migrasi, bukan klaim fitur Next.js sudah dibuat atau
pengujian perangkat telah diulang.

## Sumber kebenaran

- Baseline fork: GenieACS v1.2.16, commit
  `38e9dfd0e6dcac51087d11040784fda76ad2460a`.
- Referensi lokal: folder `genieacs` di sebelah clone `genieacs-pwa`.
- Runtime referensi: container GenieACS memakai image `genieacs-wan:local`; tag
  lokal dan image container cocok saat snapshot awal; tiga service sehat pada
  waktu itu. Pemeriksaan terakhir menemukan container referensi berhenti. Sesi
  ini tidak menyalakannya. Bundle snapshot `app-6EUL6EMF.js` memuat ketiga
  koreksi firmware di bawah.
- Hash enam override UI, `patch-ui.cjs`, dan extension `acs-config.js` cocok
  antara referensi lokal dan container.
- Seluruh source `lib/` dan `bin/` runtime identik dengan baseline fork setelah
  normalisasi line ending. Selisih source runtime: tujuh file UI/build berubah
  dan lima file UI baru.
- Provision `inform` aktif di MongoDB cocok dengan salinan lokal setelah
  normalisasi line ending: panjang 2.598 karakter, SHA-256
  `3b1e75f0b9ba832f94ee8614fc5d13868601dfaea4fdd6a679d7e81baaddf001`.
- Snapshot metadata: 3.886 config, empat preset, empat provision, 19 virtual
  parameter, tujuh perangkat. Preset `useradmin` tidak aktif.

## Fitur baseline

Setiap kelompok berikut harus mempunyai alur modern yang dapat dipakai lewat HP
dan desktop serta mempertahankan pembatasan permission backend.

| Kelompok                | Kemampuan yang harus tersedia                                                                | Kriteria penerimaan                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Inisialisasi dan akun   | Wizard instalasi, login/logout, ganti password                                               | Instalasi kosong dan akun existing mempunyai alur yang jelas; kegagalan autentikasi tidak membocorkan secret       |
| Overview                | Ringkasan, chart, indikator kondisi dan filter                                               | Nilai mengikuti data/filter yang benar; sumber dan waktu data dapat dikenali                                       |
| Daftar perangkat        | Filter, pencarian, sort, pagination, kolom, CSV                                              | Query/pagination di server; pilihan filter dan halaman dapat dipulihkan saat navigasi                              |
| Detail perangkat        | Identitas, firmware, Inform, uptime, IP, parameter dan timestamp                             | Nilai tidak didukung ditandai belum tersedia; nilai writable dibedakan dari read-only                              |
| Parameter dan objek     | Baca/refresh, edit nilai bertipe, tambah/hapus objek, pencarian parameter                    | Tipe TR-069 terjaga; hasil sebagian dan error RPC terlihat; jalur ACS aktif dilindungi                             |
| WiFi                    | Informasi SSID, status, kredensial dan perubahan yang didukung profil                        | Form mengikuti kemampuan perangkat; perubahan WiFi dibedakan dari binding WAN ke SSID                              |
| Task operasional        | Staging/review/cancel sebelum kirim, Summon, reboot, reset, download firmware dan hasil task | Konfirmasi aksi penting; tidak menganggap HTTP sukses sebagai task done; tidak membuat antrean/retry otomatis baru |
| Tags dan operasi daftar | Pengelolaan tags dan aksi banyak perangkat yang tersedia                                     | Perangkat terpilih dan status hasil per perangkat jelas; permission tetap berlaku                                  |
| Fault                   | Daftar/filter/detail/CSV dan penghapusan yang diizinkan                                      | Error dapat ditelusuri; pembersihan tidak menyentuh fault di luar lingkup aksi                                     |
| Preset                  | Daftar, buat/edit/hapus, kondisi, event, jadwal, urutan, argumen provision                   | Round-trip konfigurasi mempertahankan perilaku engine                                                              |
| Provision               | Daftar, editor script, simpan/hapus                                                          | Error validasi/save jelas dan konfigurasi yang tidak disentuh tetap utuh                                           |
| Virtual parameter       | Daftar, editor, simpan/hapus dan pembacaan nilai                                             | Nama, sifat writable, dan perilaku per perangkat dipertahankan                                                     |
| File/firmware           | Upload metadata, daftar, download, hapus, pemilihan file untuk perangkat                     | Streaming file tanpa memuat seluruh firmware ke browser/API memory; hasil upload dan aksi dapat diperiksa          |
| Konfigurasi             | Konfigurasi engine dan pengaturan kolom/filter/chart/halaman perangkat                       | Seluruh konfigurasi existing terinventarisasi; adaptasi komponen UI diputuskan secara eksplisit                    |
| User dan permission     | Daftar, buat/edit/hapus, role, password, filter dan validator akses                          | Akses diuji di server, termasuk filter objek dan validator aksi; tombol mengikuti izin                             |
| Diagnosis               | Ping dan diagnosis yang diizinkan                                                            | Target, sumber pemeriksaan, waktu, hasil, dan batas bukti terlihat                                                 |

## Patch runtime yang wajib dipertahankan

Path pada tabel merujuk source folder referensi, bukan file yang sudah dipindah
ke Next.js. Aturan business logic dan regresi dipertahankan; integrasi renderer
Mithril dipetakan ke komponen baru.

| Patch/perilaku                      | Lingkup dan sumber                                                                        | Acceptance/regresi migrasi                                                                                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Konfigurasi WAN lengkap dan bertipe | `ui/wan-model.ts:142`, `ui/wan-editor.ts:80`                                              | Existing WAN memakai complete SetParameterValues; WAN baru memakai AddObject dengan initial values dan nama relatif. Mode, service, VLAN, NAT, alamat/kredensial, binding dan Enable tetap konsisten |
| Enum bridge F670 P3N19              | `ui/wan-model.ts:63`; F670 V6.0.10P3N19 WAN IP                                            | Ubah enum keliru PPPoE_Bridged menjadi IP_Bridged; WAN PPP tetap memakai capability-nya                                                                                                              |
| Enum bridge F670 P3N3               | `ui/wan-model.ts:63`; F670 V6.0.10P3N3 WAN IP                                             | Koreksi yang sama berlaku untuk versi ini; firmware lain mengikuti capability asli                                                                                                                   |
| Enum bridge F609                    | `ui/wan-model.ts:63`; F609 V5.2.10P5T13 WAN IP                                            | Form existing/new WAN memakai IP_Bridged dan mempertahankan service/binding yang diminta                                                                                                             |
| Service bridge P3N19                | `ui/wan-model.ts:58`, `ui/wan-editor.ts:68`                                               | OTHER menjadi INTERNET hanya untuk F670 P3N19 WAN IP bridge; aturan ini tidak digeneralisasi ke P3N3, F609, routed WAN, atau WAN PPP                                                                 |
| Binding setelah ganti mode          | `ui/wan-editor.ts:105`                                                                    | Setelah mode bridge berhasil: refresh lalu reapply binding. Refresh gagal menghentikan follow-up dan menghasilkan status sebagian                                                                    |
| Validasi bridge                     | `ui/wan-model.ts:148`                                                                     | NAT mati dalam task yang sama; bridge aktif memerlukan binding LAN/WLAN; kombinasi TR069 yang memutus jalur manajemen ditolak                                                                        |
| Perlindungan jalur ACS              | `ui/wan-model.ts:136`                                                                     | Identifikasi WAN manajemen dari ConnectionRequestURL dan alamat WAN. Guard mencakup form, raw edit, dan delete pada server; implementasi lama baru melindungi form                                   |
| VLAN pertama dan untagged           | `ui/wan-editor.ts:23`, `:124`; `ui/wan-model.ts:158`                                      | Form baru menerima ID VLAN pertama; ID kosong saat tagging aktif ditolak; uncheck eksplisit menghasilkan untagged dengan tipe nilai yang tepat                                                       |
| Password dan redaksi                | `ui/wan-model.ts:119`, `:160`; `ui/parameter-table.ts:53`; `docker/genieacs/patch-ui.cjs` | Input kosong mempertahankan password existing; PPP baru memerlukan password; secret tidak muncul dalam tabel, ringkasan, cache offline, toast, atau log                                              |
| Konflik task/fault                  | `ui/wan-editor.ts:84`                                                                     | Cegah task WAN bersamaan pada target yang sama. Pembersihan fault hanya pada penulisan parsial/virtual PPP yang terkait dan memerlukan izin fault write                                              |
| Satu alur editor WAN                | `ui/parameter-table.ts:50`; `ui/wan-staging.ts:6`                                         | Tombol Atur/Tambah, baris tabel, dan edit virtual PPP memakai form lengkap; open/close, pergantian target, dan render diuji                                                                          |
| Hasil task akurat                   | `ui/wan-editor.ts:29`                                                                     | Connection Request gagal, fault, pending, timeout, dan error jaringan tidak berubah menjadi notifikasi sukses penuh                                                                                  |
| Instance AddObject sebagian         | Catatan `2026-11-01-f609-vlan1100-ssid2.md`                                               | Gagal initial values dapat meninggalkan instance kosong/disabled. Refresh dan identifikasi instance sebelum pengguna mencoba lagi; tidak membuat instance duplikat secara otomatis                   |
| Extension alamat ACS                | `config/ext/acs-config.js:4`                                                              | Mendukung host manual atau IP PPP; PPP tanpa IPv4 dan URL tidak valid menghasilkan error jelas                                                                                                       |
| Provision Inform                    | `config/provisions/inform.js:4`, `:32` dan hash database aktif                            | Pemanggilan ext dua argumen dipertahankan. URL, Connection Request, dan Periodic Inform tetap terkonfigurasi; interval referensi 200 detik dicatat sebagai baseline, bukan angka kapasitas final     |

## Batas bukti dan hal yang perlu diperbaiki

- Tes referensi saat ini berisi 20 model test dan 22 UI test; dokumen operasi
  melaporkan 42 lulus. Audit ini hanya membaca source/tes dan mencocokkan
  runtime; tidak menjalankan tes atau mengirim perintah ke modem.
- Dokumen operasi mencatat RPC dan fresh read yang berhasil pada waktunya. Hasil
  historis tersebut tidak sama dengan pengujian perangkat ulang pada proses
  migrasi.
- OTHER pada F670 P3N3 belum diuji. Binding/Enable melalui CWMP telah diperiksa
  secara historis; asosiasi WiFi fisik, DHCP, dan trafik bridge belum diuji.
- Binding WAN ke SSID berbeda dari mengubah nama atau Enable SSID. Manager WiFi
  lengkap perlu pemetaan parameter dan pengujian tersendiri.
- Provision Inform referensi memilih cabang TR-181 berdasarkan brand MikroTik,
  sehingga belum merupakan deteksi kemampuan TR-181 umum untuk semua vendor.
- Provision aktif masih memuat literal kredensial. Migrasi memakai konfigurasi
  lokasi/secret, mempertahankan `useradmin` nonaktif, dan tidak menyalin nilai
  tersebut menjadi default publik.
- Label menunggu Inform pada UI lama tidak membuktikan antrean persisten. Hasil
  baru harus sesuai ADR perintah tanpa antrean otomatis.
- Bukti regresi baru harus mencakup guard server untuk delete/raw write dan
  hasil parsial AddObject, selain seluruh aturan firmware yang sudah dikenal.

## Syarat penerimaan akhir

Setiap baris memiliki bukti tes model/integrasi/UI yang sesuai. Operasi terhadap
perangkat nyata hanya diuji pada perangkat uji yang ditentukan pengguna. Sebelum
release, verifikasi perilaku CWMP dan trafik nyata yang relevan; keberhasilan
kompilasi atau payload tersimpan saja belum cukup untuk menyatakan konfigurasi
pelanggan bekerja.
