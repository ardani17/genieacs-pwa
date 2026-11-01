---
status: accepted
---

# Konfigurasi VPN persisten tanpa rollback otomatis

Profil VPN dan alamat ACS tersimpan menjadi sumber konfigurasi utama setelah
bootstrap pertama dari .env. Alamat ACS mendukung IP dan DNS, termasuk mode
auto-PPP referensi. Reset ke konfigurasi deployment dilakukan secara eksplisit.

Profil baru yang gagal tetap aktif menunggu koreksi admin. Gangguan sementara
memicu redial profil itu; penolakan kredensial menghentikan retry sampai koreksi
atau reconnect admin. Tidak ada kembali otomatis ke profil lama. Pilihan ini
mengutamakan konfigurasi yang sengaja dipilih admin dan membuat kegagalan
terlihat; dashboard tetap terjangkau melalui jalur host terpisah.
