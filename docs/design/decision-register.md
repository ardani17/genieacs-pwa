# Register keputusan

Tanggal pembekuan: 1 November 2026. Seluruh jawaban Q1–Q22 telah diterima.
Dokumen ini mencatat keputusan pengguna; nilai teknis pada kontrak adalah
rancangan pelaksanaan untuk ditinjau. Sesi ini hanya menghasilkan dokumentasi.

| ID  | Keputusan yang diterima                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Frontend Next.js baru dalam fork; engine GenieACS dipertahankan, backend diperluas seperlunya. Pembaruan dependency keamanan termasuk lingkup perencanaan. |
| Q2  | Seluruh fungsi operasional/admin serta patch referensi masuk acceptance parity.                                                                            |
| Q3  | PWA dengan indikator offline dan asal cache yang jelas.                                                                                                    |
| Q4  | Satu profil/tunnel L2TP aktif; multi-tunnel/protokol lain di luar rilis awal.                                                                              |
| Q5  | Dashboard tetap dapat diakses melalui LAN IP laptop atau public IP+port VPS saat VPN ACS gagal.                                                            |
| Q6  | Tidak menambah antrean otomatis perintah perangkat; hasil/error dan log harus jelas.                                                                       |
| Q7  | Kapasitas awal 10.000 pelanggan dengan filter, pagination, diagnosis.                                                                                      |
| Q8  | Cache persisten awal hanya aset/tampilan generik dan halaman offline; tidak menyimpan snapshot ONT.                                                        |
| Q9  | Akun, role, permission GenieACS menjadi sumber identitas tunggal.                                                                                          |
| Q10 | Web HTTP IP+port didukung; install/offline PWA pada HTTPS terpercaya atau localhost sesuai kemampuan browser.                                              |
| Q11 | Alamat ACS fleksibel IP atau DNS, terpisah dari alamat dashboard; kemampuan auto-PPP referensi dipertahankan.                                              |
| Q12 | Profil VPN baru yang gagal tetap dipakai sampai dikoreksi admin; tanpa rollback otomatis ke profil lama.                                                   |
| Q13 | Perhitungan awal satu pelanggan satu ONT utama; tanpa CRM/billing.                                                                                         |
| Q14 | VictoriaLogs + Vector, Docker, pencarian log melalui aplikasi.                                                                                             |
| Q15 | Linux Docker rootful dan Windows Docker Desktop/WSL2 yang lolos preflight PPP.                                                                             |
| Q16 | Admin mengelola VPN dan log global; operator/teknisi hanya status VPN dan diagnosis perangkat sesuai izin.                                                 |
| Q17 | Sesi absolut 8 jam; permission tetap diperiksa selama sesi.                                                                                                |
| Q18 | Retensi log 14 hari dan target storage 10 GB. Buffer collector 1 GiB dari usulan sebelumnya tetap menjadi rancangan teknis.                                |
| Q19 | Bila log pusat dan buffer gagal, aplikasi tetap beroperasi disertai status logging degraded dan risiko kehilangan riwayat.                                 |
| Q20 | Benchmark 10.000 ONT: 4 vCPU, RAM 8 GiB, SSD, 20 operator, p95 API daftar/filter ≤2 detik. Bukan timeout task CWMP.                                        |
| Q21 | Konfigurasi VPN/alamat ACS tersimpan bertahan saat restart dan mengalahkan bootstrap .env; reset harus eksplisit.                                          |
| Q22 | Gangguan sementara melakukan redial profil aktif; penolakan kredensial menghentikan retry sampai koreksi/reconnect admin.                                  |

## Tambahan setelah wawancara

- Gunakan Context7 dan advisory primer untuk menyusun upgrade dependency backend
  dan frontend patched stable. Tidak mengubah package/lockfile pada sesi ini.
- Versi rilis fork selalu berurutan: `v1.2.16 → v1.2.17 → v1.2.18`, termasuk
  perubahan besar. Tidak menaikkan major/minor untuk melompati urutan. Versi
  upstream dicatat terpisah. Aturan lengkap:
  [release-policy.md](release-policy.md).
- Pekerjaan pelaksanaan dibagi menjadi paket kecil dengan branch/PR, kontrak,
  pengujian, logging, kondisi berhenti, serta tiket Linear per paket.

## Batas keputusan

Tidak ada preferensi Q1–Q22 yang masih menunggu jawaban. Rancangan lengkap
beserta paket pelaksanaan disiapkan untuk review pengguna, bukan izin memulai
implementasi. Bukti perangkat selain tiga profil ZTE referensi belum tersedia;
UI generik tetap dapat membaca parameter, tetapi pengaturan khusus vendor
memerlukan fixture dan uji perangkat sebelum dinyatakan didukung.

Nilai versi pada [security-upgrade.md](security-upgrade.md) adalah snapshot
riset. Agen pelaksana wajib mengecek ulang advisory dan graph sebelum
merge/release; temuan baru memperbarui rencana keamanan, bukan melemahkan
pemeriksaan.

## Tambahan pengguna — alert GitHub

Seluruh temuan
[Code Scanning](https://github.com/ardani17/genieacs-pwa/security/code-scanning)
dan [Dependabot](https://github.com/ardani17/genieacs-pwa/security/dependabot)
diminta masuk planning. Snapshot API 16 CodeQL+1 Dependabot dipetakan pada
[register](github-security-alerts.md), sembilan paket M01-S1–S9 dan 43 paket
total. Perbaikan source/dependency serta penutupan alert tetap pekerjaan
implementasi; sesi ini hanya memperbarui dokumen/tiket dan dependency gate.

## Revisi UI — 4 November 2026

Pengguna meminta shadcn/ui menjadi kontrak fondasi UI/UX dan rencana dicatat di
Linear sebelum refactor. Source komponen resmi disimpan di repository, memakai
primitive Radix, Tailwind CSS 4, CSS variables semantik dan ikon Lucide lokal.
Tema biru-putih, font sistem, mobile-first serta batas server/BFF tetap berlaku.
Keputusan ini mengganti pilihan CSS Modules custom sebagai fondasi frontend.

[Kontrak sistem desain](ui-design-system.md) dan tiket UI-01/ARD-218,
UI-02/ARD-219, UI-03/ARD-220 menjadi acuan migrasi dan acceptance visual.
Pekerjaan lama tetap mempunyai riwayatnya; scope tambahan membuka M03–M04
kembali sampai fondasi, halaman, tes dan preview yang konsisten selesai.
