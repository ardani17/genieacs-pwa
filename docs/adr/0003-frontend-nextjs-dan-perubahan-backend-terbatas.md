---
status: accepted
---

# Frontend Next.js dengan perubahan backend terbatas

Frontend Next.js dikembangkan sebagai aplikasi terpisah dalam repository fork,
sementara GenieACS v1.2.16 tetap menjadi engine pengelolaan perangkat. Backend
hanya diperluas ketika kemampuan yang diperlukan belum tersedia, misalnya
parameter atau endpoint pendukung. Pilihan ini mempertahankan perilaku TR-069
dan memusatkan modernisasi pada pengalaman pengguna serta integrasinya.

Tambahan pengguna: pembaruan dependency backend dan patch frontend masuk rencana
keamanan, memakai Context7 dan advisory primer. Upgrade dependency tidak
otomatis mengizinkan penulisan ulang engine atau migrasi arsitektur luas.
