# Desain GenieACS PWA

Tanggal: 1 November 2026. Status: dokumen untuk review; implementasi belum
dimulai. Jawaban lengkap pengguna berada pada
[register keputusan](decision-register.md).

## Hasil yang dituju

Dashboard Next.js mobile first, tema biru-putih, dengan kesetaraan seluruh
fungsi UI GenieACS dan patch deployment referensi. GenieACS tetap menjadi engine
TR-069; pembaruan dependency keamanan dan endpoint pendukung terbatas
direncanakan tanpa menulis ulang engine.

Satu instalasi melayani satu tim ISP, sekitar 10.000 ONT utama. Seluruh komponen
berjalan melalui Docker. Dashboard mempunyai jalur LAN/public yang tetap
tersedia ketika satu tunnel L2TP ACS gagal. Dukungan host awal Linux rootful dan
Windows Docker Desktop/WSL2 dengan preflight kernel/PPP.

PWA awal menyimpan aset generik dan halaman offline. Data pelanggan/perangkat,
session dan hasil API tidak masuk cache persisten. Ikon Offline menjelaskan
bahwa hanya tampilan cache tersedia. HTTP IP+port menyediakan web biasa;
install/offline memerlukan HTTPS terpercaya atau localhost.

## Keputusan operasi

Identitas dan permission tetap milik GenieACS. Sesi absolut 8 jam, role/filter/
validator diperiksa server. Admin mempunyai hak VPN dan log global; operator
melihat status serta diagnosis perangkat sesuai izin.

Alamat ACS dapat berupa IP, DNS, atau mode auto-PPP referensi. URL ini berbeda
dari URL dashboard. Perubahan alamat tidak otomatis memindahkan ONT yang tidak
lagi dapat menghubungi ACS. Profil VPN/alamat ACS yang tersimpan mengalahkan
bootstrap .env dan bertahan saat restart. Profil baru gagal tetap aktif sampai
koreksi admin. Retry gangguan jaringan berjalan pada profil tersebut; penolakan
kredensial menghentikan retry sampai tindakan admin.

Perintah perangkat dilakukan sekali melalui jalur UI native yang berizin, tanpa
antrean persisten baru. Timeout, fault, pending dan hasil parsial tidak menjadi
sukses. Logger terstruktur sejak fondasi, Vector + VictoriaLogs, retensi 14
hari/target 10 GB/buffer 1 GiB. Semua storage log gagal tetap mengizinkan
pemulihan aplikasi dengan peringatan logging degraded.

## Bukti yang membatasi rancangan

- Baseline source GenieACS `v1.2.16`. PR setup #1 dan security policy #3 sudah
  merged ke development. PR release #4 sudah merged ke main@be5dcb0 pada
  snapshot alert GitHub berikutnya.
- Snapshot read-only sebelumnya membuktikan patch UI/build, source lib/bin
  baseline, serta konfigurasi/provision referensi. Saat pemeriksaan terakhir
  container referensi berhenti. Sesi ini tidak menyalakan atau mengubahnya.
- Endpoint UI native menggunakan Authorizer; NBI tidak mewarisi permission UI.
  Browser/BFF tidak boleh memakai NBI sebagai jalan pintas untuk aksi pengguna.
- Bootstrap session/config masih berada di HTML; diperlukan endpoint JSON yang
  menyeleksi field, tidak mengekspor password/salt dari snapshot user.
- Endpoint task UI membersihkan task yang baru diajukan setelah percobaan sesi.
  NBI mempunyai perilaku antrean berbeda. Batas task 100 di UI lama hanya
  client-side; rencana menegakkannya kembali di server.
- PPP memerlukan dukungan kernel. Interface PPP hidup bukan bukti semua ONT
  terjangkau. DNS ACS juga bukan layanan dynamic DNS otomatis.
- Referensi L2TP tanpa IPsec dipertahankan untuk parity. Perubahan protokol/
  multi-tunnel merupakan pekerjaan terpisah.
- Riset dependency mendapati advisory pada versi lockfile. Itu kecocokan versi,
  bukan bukti eksploitasi runtime. Frontend Next.js belum ada pada baseline.

## Peta dokumen

1. [Spesifikasi dan kontrak](contracts.md): topologi, API, auth, perangkat, VPN,
   logging, UX, cache dan kapasitas.
2. [Kesetaraan fitur](feature-parity.md): inventaris lengkap beserta patch dan
   batas bukti.
3. [Upgrade keamanan](security-upgrade.md): Context7, advisory, target versi dan
   regresi kompatibilitas.
4. [Kebijakan release](release-policy.md): urutan versi fork, CI dan pemulihan.
5. [Roadmap](delivery-roadmap.md): M00–M09 dan paket per tahap.
6. [Indeks rencana](../superpowers/plans/2026-11-01-genieacs-pwa.md): urutan
   eksekusi, read set, command dan paket langkah demi langkah.
7. [Standar handoff](agent-handoff.md), [glosarium](../../GLOSSARY.md), dan
   [ADR](../adr/).

## Pelacakan

[Project Linear](https://linear.app/ardani/project/genieacs-pwa-d3ed65fad9ef),
[ARD-153 desain](https://linear.app/ardani/issue/ARD-153),
[ARD-154 inventaris](https://linear.app/ardani/issue/ARD-154). Implementasi
tetap Backlog sampai dokumen ditinjau dan tahap pelaksanaan dimulai secara
terpisah. Rencana tidak menandai uji simulasi sebagai bukti trafik WiFi/LAN
nyata atau dukungan Huawei/FiberHome yang belum diverifikasi.

## Tambahan alert GitHub

16 CodeQL open dan 1 Dependabot open dipetakan ke
[register keamanan](github-security-alerts.md). Sembilan paket S1–S9/ARD-198–206
dikerjakan pada M01 sebelum frontend baru. Kompilasi untuk validasi script
dibedakan dari eksekusi admin yang disengaja; crypto wire legacy tidak diubah
sepihak. Scan SUCCESS bukan bukti bersih; exact ref/commit dan review risiko
menjadi gate. PR release#4 sudah merged ke main@be5dcb0 saat pembacaan API ini.
