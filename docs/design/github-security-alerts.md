# Rencana perbaikan alert GitHub

Snapshot **1 November 2026, 21:24 Asia/Bangkok** (14:24 UTC), diambil melalui
GitHub API terautentikasi.
[Code Scanning](https://github.com/ardani17/genieacs-pwa/security/code-scanning)
memiliki **16 alert open: 2 critical, 12 high, 2 medium**.
[Dependabot](https://github.com/ardani17/genieacs-pwa/security/dependabot)
memiliki **1 alert open, low**. Ini laporan scanner dan rencana perbaikan, bukan
konfirmasi bahwa semua jalur dapat dieksploitasi.

## Asal bukti dan batas pemeriksaan

- CodeQL menandai main@`be5dcb0e0d4f94b7a59b1f625c4b35a6340e6e3b`. Source
  sepuluh file yang ditandai identik dengan planning@`1942b51` berdasarkan git
  diff. Alert instances juga dapat berada pada development; contoh#3 ada di main
  serta development dengan analysis category berbeda.
- Main sudah memuat merge release PR#4, tetapi snapshot ini tidak menambahkan
  tag atau release baru. Nomor release fork tetap mengikuti release-policy.md.
- Public web fetch kedua halaman menghasilkan404, sedangkan GitHub API dengan
  akun repository berhasil.404 publik tidak diartikan sebagai nol alert.
- Tidak mengirim payload ke ACS/ONT, menjalankan PoC, atau mengubah source,
  lockfile, scan settings, alert state maupun deployment dalam tahap ini.
- [Snapshot terkurasi](github-security-alerts.json) menyimpan ID, severity,
  lokasi, source ref/commit, paket dan tiket. Jangan memakai nomor baris saja
  sebagai identitas; setelah patch cocokkan rule+path+sink+instance commit.

## Pemetaan alert lengkap

| Alert                                                                           | Severity GitHub | Lokasi snapshot                             | Rule / konteks                                                                                                 | Paket / tiket                                                            |
| ------------------------------------------------------------------------------- | --------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [CodeQL#1](https://github.com/ardani17/genieacs-pwa/security/code-scanning/1)   | medium          | `lib/ui/api.ts:407`                         | `js/xss-through-exception`                                                                                     | [M01-S3 / ARD-200](https://linear.app/ardani/issue/ARD-200)              |
| [CodeQL#2](https://github.com/ardani17/genieacs-pwa/security/code-scanning/2)   | medium          | `lib/ui/api.ts:448`                         | `js/xss-through-exception`                                                                                     | [M01-S3 / ARD-200](https://linear.app/ardani/issue/ARD-200)              |
| [CodeQL#3](https://github.com/ardani17/genieacs-pwa/security/code-scanning/3)   | high            | `lib/common/expression/util.ts:53`          | `js/regex-injection`                                                                                           | [M01-S4 / ARD-201](https://linear.app/ardani/issue/ARD-201)              |
| [CodeQL#4](https://github.com/ardani17/genieacs-pwa/security/code-scanning/4)   | high            | `lib/query.ts:8`                            | `js/incomplete-sanitization`                                                                                   | [M01-S3 / ARD-200](https://linear.app/ardani/issue/ARD-200)              |
| [CodeQL#5](https://github.com/ardani17/genieacs-pwa/security/code-scanning/5)   | high            | `lib/query.ts:15`                           | `js/incomplete-sanitization`                                                                                   | [M01-S3 / ARD-200](https://linear.app/ardani/issue/ARD-200)              |
| [CodeQL#6](https://github.com/ardani17/genieacs-pwa/security/code-scanning/6)   | high            | `lib/ui/api.ts:271`                         | `js/incomplete-sanitization`                                                                                   | [M01-S3 / ARD-200](https://linear.app/ardani/issue/ARD-200)              |
| [CodeQL#7](https://github.com/ardani17/genieacs-pwa/security/code-scanning/7)   | high            | `lib/nbi.ts:652`                            | `js/sql-injection`                                                                                             | [M01-S2 / ARD-199](https://linear.app/ardani/issue/ARD-199)              |
| [CodeQL#8](https://github.com/ardani17/genieacs-pwa/security/code-scanning/8)   | high            | `lib/nbi.ts:673`                            | `js/sql-injection`                                                                                             | [M01-S2 / ARD-199](https://linear.app/ardani/issue/ARD-199)              |
| [CodeQL#9](https://github.com/ardani17/genieacs-pwa/security/code-scanning/9)   | critical        | `lib/ui/db.ts:455`                          | `js/code-injection`                                                                                            | [M01-S1 / ARD-198](https://linear.app/ardani/issue/ARD-198)              |
| [CodeQL#10](https://github.com/ardani17/genieacs-pwa/security/code-scanning/10) | critical        | `lib/ui/db.ts:482`                          | `js/code-injection`                                                                                            | [M01-S1 / ARD-198](https://linear.app/ardani/issue/ARD-198)              |
| [CodeQL#11](https://github.com/ardani17/genieacs-pwa/security/code-scanning/11) | high            | `lib/auth.ts:87`                            | `js/weak-cryptographic-algorithm`                                                                              | [M01-S6 / ARD-203](https://linear.app/ardani/issue/ARD-203)              |
| [CodeQL#12](https://github.com/ardani17/genieacs-pwa/security/code-scanning/12) | high            | `lib/connection-request.ts:204`             | `js/weak-cryptographic-algorithm`                                                                              | [M01-S7 / ARD-204](https://linear.app/ardani/issue/ARD-204)              |
| [CodeQL#13](https://github.com/ardani17/genieacs-pwa/security/code-scanning/13) | high            | `lib/xmpp-client.ts:180`                    | `js/weak-cryptographic-algorithm`                                                                              | [M01-S8 / ARD-205](https://linear.app/ardani/issue/ARD-205)              |
| [CodeQL#14](https://github.com/ardani17/genieacs-pwa/security/code-scanning/14) | high            | `lib/xmpp-client.ts:209`                    | `js/weak-cryptographic-algorithm`                                                                              | [M01-S8 / ARD-205](https://linear.app/ardani/issue/ARD-205)              |
| [CodeQL#15](https://github.com/ardani17/genieacs-pwa/security/code-scanning/15) | high            | `lib/common/expression/parser.ts:161`       | `js/redos`                                                                                                     | [M01-S4 / ARD-201](https://linear.app/ardani/issue/ARD-201)              |
| [CodeQL#16](https://github.com/ardani17/genieacs-pwa/security/code-scanning/16) | high            | `lib/cwmp.ts:1341`                          | `js/polynomial-redos`                                                                                          | [M01-S5 / ARD-202](https://linear.app/ardani/issue/ARD-202)              |
| [Dependabot#1](https://github.com/ardani17/genieacs-pwa/security/dependabot/1)  | low             | `package.json`, esbuild^0.27.4 (lock0.27.4) | [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr), affected>=0.27.3<0.28.1, fixed0.28.1 | [M01-B / ARD-165](https://linear.app/ardani/issue/ARD-165), target0.28.2 |

## Urutan, prioritas dan gate

M01-A harness/inventory → M01-B dependency (termasuk Dependabot#1) →
**M01-S1…M01-S9** → M01-C frontend → M01-D…F → M02 dan seterusnya. S1
kritikalitas tertinggi, lalu NBI/input. Crypto dipisah per protokol agar satu
agen mengerjakan satu perubahan yang dapat direview. S9 menutup rangkaian dengan
bukti scan pada commit dan branch yang benar.

[Rencana sembilan paket](../superpowers/plans/2026-11-01-genieacs-pwa/m01-security-alerts.md)
berisi read/write set, signature, tes awal, langkah, acceptance, stop/recovery,
branch dan tiket. Sembilan paket tambahan ini menaikkan total rencana dari34
menjadi **43 paket**. Upgrade esbuild tidak dibuat sebagai task duplikat. Semua
paket implementasi tetap Backlog, menunggu review desain/prasyarat.

CodeQL#9/#10 berada pada `new vm.Script` untuk validasi sintaks script admin.
Source yang dibaca tidak menjalankannya pada save. Rencana mengganti validator
dengan AST-only Acorn8.19.0, sambil mempertahankan permission dan runtime
provision sebagai fitur admin. Menandai sink critical bukan bukti otomatis
unauthenticated RCE. Acorn dipin exact dan lock diaudit pada implementasi.

CodeQL#7/#8 berada pada Mongo find/count dengan query JSON NBI, meski nama rule
menyebut SQL. Perbaikan memakai grammar/operator allowlist dan budget, bukan SQL
parameter binding yang tidak relevan.

CodeQL#11 adalah HTTP Digest MD5, #12 HMAC-SHA1 UDP Connection Request, #13/#14
HMAC pada XMPP SCRAM-SHA-1. Algoritme wire tidak diganti sepihak. S6 menambah
Digest SHA256 yang benar; S7 mempertahankan signature AnnexG dan memperbaiki
message ID; S8 memprioritaskan SCRAM-SHA256/TLS. Residual legacy adalah risiko
protokol yang perlu review manusia, dengan bukti interoperabilitas, scope,
mitigasi, pemilik dan expiry≤30hari. Tidak ada dismiss otomatis atau suppression
untuk sekadar membuat scanner hijau.

Dependabot esbuild adalah development-server arbitrary file read di Windows.
Source repo tidak ditemukan memakai esbuild serve; patch tetap direncanakan.
Satu alert Dependabot tidak berarti semua dependency lain aman: riset
[security-upgrade.md](security-upgrade.md), minimatch blocker dan audit graph
root/web/image tetap berlaku.

## Syarat penerimaan keamanan

1. Setiap17alert snapshot memiliki paket, tiket, testID, PR/commit dan
   disposition eksplisit. State awal planned; belum ada fixed_verified.
2. Perbaikan source mempunyai tes regresi negatif+parity fungsi native. Tes
   payload/performa berjalan terisolasi dengan resource cap; tidak di host/
   deployment referensi.
3. CodeQL rerun pada exact commit development setelah merge. Alert dapat masih
   open pada main sampai release memasukkan patch; verifikasi main setelah
   release. Jangan mendismiss alert main untuk menutupi keterlambatan.
4. CI/CodeQL job SUCCESS hanya membuktikan analisis selesai. Gate S9 memeriksa
   alert/instance/ref/commit, freshness, pagination dan exception terverifikasi.
5. Critical/high yang belum ditangani/direview memblok release. MediumXSS dan
   lowesbuild pada snapshot ini juga wajib ditutup melalui fix terverifikasi.
   Pengecualian protokol yang ditinjau tetap risk_accepted, bukan fixed.
6. Dismissal/suppression hanya keputusan reviewer manusia dengan alasan terukur.
   Gate tidak boleh mematikan query/category, melewati403, atau menganggap
   laporan kosong/tidak tersedia sebagai aman.
7. Tidak merombak engine atau mengurangi parity sebagai jalan pintas. Migrasi
   security yang membatasi NBI/XMPP harus mempunyai breaking-change notes dan
   langkah pemulihan; nomor release tetap berurutan.

## Sumber primer

- [Node VM](https://nodejs.org/api/vm.html): VM bukan batas keamanan untuk
  menjalankan kode tak tepercaya; parser save dan runtime execution dibedakan.
- [Acorn](https://github.com/acornjs/acorn) dan
  [metadata8.19.0](https://registry.npmjs.org/acorn/8.19.0): parser AST,
  dependency runtime kosong menurut metadata snapshot.
- [CodeQL code injection](https://codeql.github.com/codeql-query-help/javascript/js-code-injection/)
  dan
  [regex injection](https://codeql.github.com/codeql-query-help/javascript/js-regex-injection/).
- [HTTP Digest RFC7616](https://www.rfc-editor.org/info/rfc7616/),
  [SCRAM RFC5802](https://www.rfc-editor.org/info/rfc5802/) dan
  [SCRAM-SHA256 RFC7677](https://www.rfc-editor.org/info/rfc7677/).
- [TR069 Amendment3 AnnexG](https://www.broadband-forum.org/pdfs/tr-069-1-3-0.pdf)
  menjelaskan signature UDP HMAC-SHA1. Ini rujukan wire compatibility, bukan
  alasan meniadakan review risiko.
- [GitHub alert resolution](https://docs.github.com/en/code-security/how-tos/manage-security-alerts/manage-code-scanning-alerts/resolve-alerts)
  membedakan fix/scan/disposition; perubahan kode yang belum masuk branch
  teranalisis belum menjadi bukti alert di branch tersebut fixed.
