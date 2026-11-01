---
status: accepted
---

# VPN client menjadi bagian dari instalasi

Instalasi Docker menyertakan VPN client agar ACS dapat berinterkoneksi dengan
jaringan ISP dari host deployment yang berbeda. Administrator mengelola server,
akun, rute, pemeriksaan koneksi, dan reconnect dari aplikasi. Pilihan ini
menyatukan pengelolaan interkoneksi dengan instalasi ACS dan mengurangi
ketergantungan pada pengaturan VPN manual di host.

Rilis awal memakai satu profil dan satu tunnel L2TP aktif per instalasi,
mengikuti referensi yang sudah digunakan. Multi-tunnel dan protokol tambahan
menjadi pengembangan berikutnya agar routing dan diagnosis awal tetap terfokus.
