---
status: accepted
---

# Identitas native dan otorisasi server

Akun, role, filter dan validator GenieACS tetap menjadi satu sumber hak akses.
Frontend Next.js memakai backend UI yang berizin melalui BFF server, dengan
endpoint session JSON terpilih dan sesi absolut delapan jam. Jalur NBI tidak
menjadi jalan pintas otorisasi pengguna.

Pilihan ini menghindari dua direktori pengguna yang dapat berbeda. Konsekuensi:
diperlukan penambahan backend terbatas untuk bootstrap aman dan enforcement
sesi, serta permission eksplisit untuk VPN/log. Permission berubah tetap berlaku
selama sesi, mengikuti pembaruan snapshot native.
