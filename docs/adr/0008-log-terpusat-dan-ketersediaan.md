---
status: accepted
---

# Log terpusat dengan ketersediaan aplikasi sebagai prioritas

Log terstruktur dikumpulkan Vector ke VictoriaLogs dalam Docker. Pengguna
memilih retensi 14 hari dan anggaran storage 10 GB. Buffer collector dirancang 1
GiB. Pencarian/ekspor melalui aplikasi mengikuti permission native, tanpa
membuka database log langsung ke publik.

Jika sink dan buffer sama-sama gagal, operasi aplikasi tetap berjalan dengan
status logging degraded dan penjelasan risiko riwayat hilang. Trade-off ini
menjaga jalur pemulihan admin ketika sistem penyimpanan bermasalah. Redaksi
dilakukan sebelum persist; payload protokol mentah tidak otomatis menjadi log.
