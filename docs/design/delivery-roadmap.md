# Roadmap pembangunan bertahap

Status: rencana lengkap untuk review. Semua implementasi M01–M09 masih Backlog.
Sesi ini hanya menyiapkan dokumen, rencana dan Linear. Setup#1/security policy#3
sudah merged ke development; inventaris read-only ARD-154 selesai.

[Indeks43paket](../superpowers/plans/2026-11-01-genieacs-pwa.md) adalah titik
masuk agen. Baca satu paket dan read set-nya, kerjakan satu PR, kemudian review
sebelum paket berikutnya. Kontrak ada di [contracts.md](contracts.md), bukti
parity di [feature-parity.md](feature-parity.md).

| Milestone | Parent Linear                                      | Paket             | Hasil dan gate                                                                                                                                                   |
| --------- | -------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M00       | [ARD-153](https://linear.app/ardani/issue/ARD-153) | Desain/inventaris | Q1–Q22 dan tambahan keamanan/versi dicatat, kontrak/ADR/glosarium/parity/43paket ditinjau; tidak membangun aplikasi.                                             |
| M01       | [ARD-155](https://linear.app/ardani/issue/ARD-155) | A–F+S1–S9         | Inventory+security gate, dependency backend compatible, frontend patched, Docker terisolasi, JSON logger, Vector/VictoriaLogs. Sink gagal tidak menggantung app. |
| M02       | [ARD-156](https://linear.app/ardani/issue/ARD-156) | A–C               | Native identity8jam, permission live, safe bootstrap, BFF allowlist/pagination/stream/error, vpn/log permission. 401/403/filter/validator/timeout teruji.        |
| M03       | [ARD-157](https://linear.app/ardani/issue/ARD-157) | A–C               | Tema biru-putih, komponen/navigasi/login/setup mobile, status terpisah/error tracing;360/768/1440px, keyboard/focus/console gate.                                |
| M04       | [ARD-158](https://linear.app/ardani/issue/ARD-158) | A–C               | Fixture/profile/filter, overview/list/server pagination/CSV, detail/rawparams/diagnosis baca; native customconfig dan permission tetap bekerja.                  |
| M05       | [ARD-159](https://linear.app/ardani/issue/ARD-159) | A–E               | Model firmware/guard, executor/idempotency tanpa queue, phase WAN/partial, staging+operasi+WiFi/tag/fault; seluruh patch historis mendapat regresi.              |
| M06       | [ARD-160](https://linear.app/ardani/issue/ARD-160) | A–C               | Semua renderer config, editor/CRUD admin, user/permission/file/bootstrap; round-trip, role/filter/validator dan streaming tetap setara.                          |
| M07       | [ARD-161](https://linear.app/ardani/issue/ARD-161) | A–D               | Saved settings+secret/CAS, controller retry/routing, UI VPN/log, IP/DNS/autoPPP ACS+provision; profil gagal tetap aktif, dashboard tetap reachable.              |
| M08       | [ARD-162](https://linear.app/ardani/issue/ARD-162) | A–B               | Manifest/install, cache static-only/offline icon/update aman/logout; data ONT/secret tidak persist di browser. HTTP IP tetap web biasa.                          |
| M09       | [ARD-163](https://linear.app/ardani/issue/ARD-163) | A–E               | Benchmark/failure, parity/lab nyata, backup/restore/cutover, urutan versi CI, publikasi immutable; seluruh gate sebelum release.                                 |

## Alur Git

Branch tiap paket dicatat pada indeks: feature/mxx-x atau chore/mxx-x dari
development terbaru → PR development. Bug baru mendapat fix branch/tiket
reproduksi+regresi. Main berisi release melalui PR development→main, required
checks dan merge commit. PR main→development menyinkronkan riwayat sesudahnya.

Versi rilis fork **selalu berurutan v1.2.16→v1.2.17→v1.2.18**, termasuk
perombakan besar. Tag tidak mengikuti major dependency/upstream; breaking
changes tetap mempunyai migration notes. Detail pada
[release-policy.md](release-policy.md). Tidak membuat tag pada tahap docs.

## Kualitas dan observabilitas

Setiap paket membawa pengujian perilaku sukses/gagal, permission, hasil task,
error boundary dan log korelasi yang terkena perubahan. Log JSON mengalami
redaksi sebelum persist, bukan hanya sebelum ditampilkan. Vector/VictoriaLogs
dibangun M01: retensi14hari/soft target10GB/buffer1GiB. Semua storage log gagal
menghasilkan logging degraded tetapi aplikasi tetap dapat dipakai memulihkan.

Pemeriksaan format/lint/type/unit/integration/build/artifact wajib; browser
mobile/desktop untuk alur relevan, console/request failures tak terduga
menggagalkan tes. Dependency audit graph+image/SBOM ada pada M01 dan diulang
sebelum release, dengan pemantauan harian. Metadata kandidat bukan jaminan
seluruh graph bebas advisory. Blocker minimatch tooling dicatat pada
[security-upgrade.md](security-upgrade.md).

## Gate dan bukti

Planned/Backlog tidak berarti sudah dikerjakan. Ready memerlukan review desain,
prasyarat merged dan lingkungan uji sesuai paket. In Review berarti PR dengan
bukti; Done memerlukan acceptance+merge. Semua child selesai belum menggantikan
gate keseluruhan milestone (misalnya lab/performa/restore).

Referensi lama hanya sumber fakta historis. Container referensi terakhir
terlihat berhenti; sesi desain tidak menyalakan/mengubahnya. Fixture/simulator
tidak diklaim sebagai verifikasi perangkat fisik. Dukungan writable vendor/
firmware baru memerlukan bukti dan profil; saat ini tiga profil ZTE menjadi
acuan, Huawei/FiberHome/generic TR181 tetap extensible dengan status dukungan
yang jujur.

## Tambahan keamanan GitHub

[Register 17 alert](github-security-alerts.md) dan
[rencana sembilan paket](../superpowers/plans/2026-11-01-genieacs-pwa/m01-security-alerts.md)
masuk M01: A → B → S1…S9 → C…F. Validasi script critical lebih dahulu, kemudian
NBI/input/ReDoS/crypto dan gate closure. Seluruhnya Backlog; frontend ARD-166
terblokir ARD-206 sampai gate keamanan terverifikasi. Esbuild Dependabot#1 tetap
M01-B/ARD-165. Total **43 paket**, dengan 15 child M01.
