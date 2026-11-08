# Operasional VPN dan logging M07

Settings VPN/ACS disimpan dalam singleton Mongo `app_settings`. Bootstrap
deployment hanya membuat profil pertama. Restart dan perubahan environment tidak
menggantikan profil tersimpan. Simpan profil baru lebih dahulu; kegagalan
koneksi mempertahankan profil itu. Tidak ada rollback otomatis.

## Secret dan bootstrap

Untuk instalasi baru, dari root checkout pada host Linux:

```sh
sudo node docker/bootstrap-secrets.mjs --init-key --uid 10001 --gid 10001
sudo node docker/bootstrap-secrets.mjs --check
```

Tool membuat key AES-256-GCM dan dua bearer token berbeda di directory
`secrets/` yang diabaikan Git. File mode0600 dimiliki UID/GID proses UI,
10001:10001 pada Compose ini. Pada Windows jalankan dengan Node tanpa sudo; izin
bind mount mengikuti Docker Desktop. Verifikasi bahwa proses UI dapat membaca
mount sebelum menyimpan konfigurasi. Controller berjalan sebagai root untuk PPP
dan memakai token controller yang sama, tanpa menerima key enkripsi.

`--init-key` hanya untuk database instalasi baru. Jika database sudah berisi
ciphertext dan key hilang/rusak, pulihkan key dari backup. Tool tidak pernah
memperbaiki/merotasi key yang ada. Backup harus memasangkan database dan key.
`--force` hanya merotasi token, bukan key; restart pembaca token setelah
penggantian file bind mount agar inode yang baru terpasang.

Sediakan password bootstrap melalui file terpisah yang dapat dibaca UI, mode0600
dan owner10001:10001. Tetapkan `VPN_PASSWORD_HOSTFILE` ke path host itu dalam
environment deployment di luar Git. Isi file adalah password UTF-8; satu newline
penutup diperbolehkan, whitespace password lainnya dipertahankan. Tetapkan
`VPN_SERVER`, `VPN_USERNAME`, `VPN_ROUTES` (CIDR dipisah koma), `VPN_MTU`, serta
`ACS_HOST`, `ACS_PORT`, `ACS_SCHEME`, `ACS_PATH` bila diperlukan. ACS_HOST
kosong memilih auto-PPP. Nilai deployment yang tidak lengkap ditolak; admin
masih dapat membuat profil melalui UI.

Reset ke deployment memerlukan izin vpn:3, konfirmasi `RESET`, dan revision yang
masih berlaku. Kandidat tidak valid, key salah, ciphertext rusak, atau CAS
konflik mempertahankan dokumen yang ada. Installation ID tetap stabil.

## Host, koneksi dan rute

Host Linux menyediakan `/dev/ppp` character device major108 serta dukungan PPP.
Muat modul host yang tersedia: `ppp_generic`, `ppp_async`, dan dukungan kernel
L2TP bila disediakan distribusi. Docker Desktop WSL dapat menyertakan modul PPP
tanpa modul L2TP; xl2tpd pinned juga mendukung transport L2TP userspace.
Verifikasi koneksi nyata, bukan hanya keberadaan file modul atau container up.
Jangan memakai privileged, Docker socket, atau SYS_MODULE pada service VPN.

Controller menggunakan NET_ADMIN dan `/dev/ppp`, mengambil profil native melalui
token internal, dan mencoba ulang pengambilan profil setiap10detik. Satu
percobaan koneksi dibatasi60detik. Gangguan transient menunggu10/20/40/60detik
ditambah jitter0–20%; koneksi stabil60detik mereset hitungan. PAP/CHAP atau
exit19 menjeda retry sampai revisi profil atau reconnect admin. Reconnect ganda
saat connecting menjawab409. Disconnect meminta penutupan LAC sebelum mengakhiri
seluruh process group.

Maksimum32 rute IPv4; default route dan overlap interface Docker ditolak.
Tambahkan subnet ingress/dashboard host yang tidak terlihat dari namespace
container pada `VPN_PROTECTED_CIDRS`. Endpoint L2TP diresolve sebelum rute
dibuat dan dipertahankan melalui egress asli. Hanya rute dengan protocol186,
metric installation/revision, device/gateway dan CIDR yang cocok dengan jurnal
yang dibersihkan. Jurnal gagal/rusak dipertahankan untuk pemeriksaan; tabel rute
tidak pernah di-flush. Dashboard, UI, NBI dan Mongo tidak melewati PPP.

## Izin dan status

vpn:1 dapat melihat status/diagnosis; vpn:3 plus filter/validator native dapat
menyimpan profil, reconnect dan reset. Browser/BFF tidak menerima token layanan
dan tidak meneruskan endpoint internal. Diagnosis ONT memakai target CRURL yang
diturunkan setelah izin perangkat diperiksa; controller membatasi probe ke rute
ONT terpasang dan memakai source IP PPP.

Pencarian log memerlukan logs:2; ekspor memerlukan logs:3. Query memakai DTO
tertutup, rentang maksimum24jam, halaman100 dan ekspor maksimum10.000baris /
50MiB. Hasil diredaksi lagi sebelum menuju browser/download. UI menampilkan
retensi14hari, target10GB dan buffer1GiB.

Status logging menggabungkan file logger UI/web, status file controller bila
terjangkau, metrics collector internal dan health sink. Collector menyediakan
Prometheus metrics pada port9598 di jaringan internal saja. Panel menampilkan
state, sejak gangguan, keberhasilan terakhir, dropped counter dan buffer.
Kegagalan logging tidak mematikan dashboard atau menghalangi koreksi VPN.

VictoriaLogs memakai `-storageDataPath=/storage`, sama dengan volume persisten.
Jika deployment lama memakai path default `victoria-logs-data` di writable layer
container, salin/backup data lama ke volume sebelum mengganti container. Metrik
`vl_data_size_bytes` dan `vl_free_disk_space_bytes` menggerakkan
peringatan80%/90% target atau ruang bebas di bawah2GiB. Volume log bersama harus
memiliki directory root yang dapat ditulis UID10001; image tooling dan VPN
menyiapkannya juga agar urutan inisialisasi volume tidak memblokir UI/web.

## Verifikasi dan lab

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M07-A
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M07-B
docker compose -p genieacs-pwa-check -f compose.test.yaml run --rm verify node scripts/check.mjs M07-C
docker compose -p genieacs-pwa-check -f compose.test.yaml -f compose.e2e.yaml run --rm browser-tests npm run test:e2e -- e2e/vpn-logs.spec.ts
```

Browser memakai backend native dan identitas dummy; hanya efek PPP yang
deterministik. Lab nyata memakai overlay `compose.vpn-lab.yaml`, profil lokal
`secrets/m07-lab-profile.json` sesuai DesiredVpnProfile dan token fixture
terisolasi. Jangan gunakan token fixture pada deployment. Tidak ada port lab
yang dipublikasikan dan tidak ada akses ke database produksi.

```sh
docker compose -p genieacs-pwa-check -f compose.test.yaml build vpn-build
docker compose -p genieacs-pwa-check -f compose.test.yaml -f compose.vpn-lab.yaml up -d vpn-lab
docker compose -p genieacs-pwa-check -f compose.test.yaml -f compose.vpn-lab.yaml run --rm vpn-lab-probe
docker compose -p genieacs-pwa-check -f compose.test.yaml -f compose.vpn-lab.yaml run --rm vpn-lab-probe node scripts/fixtures/vpn-lab.mjs --probe --reconnect
docker compose -p genieacs-pwa-check -f compose.test.yaml -f compose.vpn-lab.yaml stop vpn-lab vpn-lab-source
```

Hasil status/reconnect tersimpan pada `artifacts/vpn-lab/`, diabaikan Git.
Endpoint dan kredensial aktual hanya berada dalam file lokal. Host image,
routes, revision dan hasil lab harus diperiksa kembali pada deployment tujuan.
