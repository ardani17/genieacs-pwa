---
status: accepted
---

# Akses dashboard independen dari VPN ACS

Dashboard dan pengelolaan VPN tetap tersedia ketika tunnel ACS terputus. Pada
laptop, aplikasi dapat diakses melalui IP lokal; pada VPS, melalui IP publik dan
port yang diizinkan oleh deployment. Koneksi aplikasi, tunnel VPN, dan
keterjangkauan perangkat memiliki status terpisah agar gangguan interkoneksi
dapat diperbaiki melalui dashboard yang masih dapat dijangkau.
