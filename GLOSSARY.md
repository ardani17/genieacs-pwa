# Pengelolaan perangkat ISP

Istilah untuk pengelolaan perangkat pelanggan dan interkoneksi ACS oleh tim
internal ISP.

## Language

**Instalasi ACS**: Satu lingkungan pengelolaan perangkat milik satu organisasi
ISP. _Avoid_: tenant, server pelanggan.

**Pengguna**: Anggota tim internal ISP yang mengakses fungsi pengelolaan sesuai
kewenangannya. _Avoid_: pelanggan, akun modem.

**Pelanggan**: Pihak yang menerima layanan ISP. Perhitungan kapasitas awal
mengaitkan satu pelanggan dengan satu ONT utama. _Avoid_: pengguna dashboard.

**Perangkat**: ONT atau router pelanggan yang dikelola ACS melalui TR-069.
_Avoid_: client tanpa penjelas.

**Profil perangkat**: Pemetaan kemampuan dan informasi pengelolaan untuk vendor,
model, serta firmware perangkat tertentu. _Avoid_: profil VPN.

**Alamat ACS**: Alamat tujuan yang digunakan perangkat untuk berkomunikasi
dengan ACS, menggunakan IP atau nama DNS. _Avoid_: alamat dashboard.

**Koneksi aplikasi**: Jalur akses pengguna ke dashboard pada alamat instalasi
yang sedang dibuka. _Avoid_: tunnel VPN.

**WAN manajemen**: Koneksi WAN perangkat yang menjaga jalur komunikasi
pengelolaan antara perangkat dan ACS. _Avoid_: semua WAN.

**Binding WAN**: Hubungan koneksi WAN dengan port LAN atau SSID yang menggunakan
koneksi tersebut. _Avoid_: pengaturan nama WiFi.

**Inform**: Laporan perangkat kepada ACS yang menandai dimulainya sesi
komunikasi TR-069.

**Task perangkat**: Perintah pengelolaan yang ditujukan kepada perangkat
tertentu. _Avoid_: provision.

**Provision**: Aturan penyelarasan konfigurasi perangkat yang dijalankan ACS.
_Avoid_: task perangkat.

**Preset**: Aturan pemilihan perangkat, kondisi, atau waktu untuk menerapkan
konfigurasi dan provision.

**Profil VPN**: Kumpulan pengaturan untuk membentuk sambungan ke jaringan ISP.
_Avoid_: tunnel, profil perangkat.

**Tunnel VPN**: Sambungan aktif yang menyediakan jalur interkoneksi antara
instalasi ACS dan jaringan ISP. _Avoid_: profil VPN.
