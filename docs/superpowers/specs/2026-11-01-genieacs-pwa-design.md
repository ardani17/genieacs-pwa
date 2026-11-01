# GenieACS PWA — spesifikasi desain

Status: siap ditinjau, implementasi terpisah. Tanggal1November2026.

Dokumen otoritatif sistem adalah [contracts.md](../../design/contracts.md). Baca
[register keputusan](../../design/decision-register.md) untuk jawaban Q1–Q22 dan
tambahan keamanan serta versi. Semua fungsi native/patch yang harus
dipertahankan tercantum pada [feature parity](../../design/feature-parity.md).

Spesifikasi dibagi menjadi subsistem agar agen memuat konteks seperlunya:
identitas/API, UX operasional/config, task/profil perangkat, VPN/ACS, logging,
PWA, kapasitas/migrasi dan release. Kontrak yang menghubungkannya memakai nama
dan DTO yang sama. Keputusan jangka panjang dicatat pada docs/adr dan istilah
domain pada GLOSSARY.md.

[Indeks34paket](../plans/2026-11-01-genieacs-pwa.md) memuat M01–M09, dependensi
Linear, branch dan command. [Security upgrade](../../design/security-upgrade.md)
menetapkan riset Context7/advisory dan blocker development;
[release policy](../../design/release-policy.md) menetapkan
v1.2.16→v1.2.17→v1.2.18 tanpa loncat termasuk perubahan besar.

Tahap ini hanya dokumentasi. Pengguna meninjau desain ini sebagai hasil konkret;
implementasi, test runtime/lab, dependency upgrade dan publikasi tag belum
dilakukan. Semua gate yang memerlukan hardware/credential/advisory terbaru tetap
diperiksa pada paket yang menanganinya.
