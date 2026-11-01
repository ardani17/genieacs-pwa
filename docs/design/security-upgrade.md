# Rencana upgrade dependency dan patch keamanan

Snapshot riset: 1 November 2026. **Belum ada dependency, lockfile, image
runtime, atau aplikasi yang di-upgrade dalam sesi dokumentasi ini.** Temuan
adalah kecocokan versi/advisory; keterjangkauan eksploitasi belum dibuktikan.

## Metode dan sumber

Lockfile v2 `npm-shrinkwrap.json` baseline v1.2.16 dibaca secara statis. Query
metadata advisory npm terhadap daftar versi menghasilkan temuan di bawah.
Perintah audit host mengembalikan ENOLOCK untuk shrinkwrap v2; hasil itu bukan
audit bersih. Tidak ada install, PoC, atau test terhadap runtime referensi.

Context7 digunakan sesudah resolve library:

| Library ID                     | Pertanyaan dan hasil yang dipakai                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/vercel/next.js`              | Next16 memakai cookies/headers async; fetch session/data memakai no-store; service worker hanya cache aset generik, private response tidak disimpan.       |
| `/mongodb/node-mongodb-native` | Driver6/7 mengembalikan document/null pada findOneAndUpdate/Delete; includeResultMetadata:true mempertahankan ModifyResult.                                |
| `/koajs/koa`                   | Migrasi Koa3 mengubah dukungan runtime/middleware lama; source ini sudah async sehingga upgrade major Koa tidak diperlukan untuk menulis ulang middleware. |

Index Context7 tidak selalu memuat patch terbaru. Versi/fixed range ditentukan
oleh registry dan advisory primer, bukan tanggal index. Rujukan:
[Next auth](https://nextjs.org/docs/app/guides/authentication),
[Next PWA](https://nextjs.org/docs/app/guides/progressive-web-apps),
[driver migration](https://www.mongodb.com/docs/drivers/node/current/reference/upgrade/),
[Koa](https://github.com/koajs/koa). Pencarian Context7 @koa/router tidak
mendapatkan library router yang tepat; kompatibilitas router diverifikasi
melalui source/release resmi.

## Versi baseline yang perlu ditangani

| Dependency terkunci                                        | Advisory primer                                                                                                                                    | Kandidat perbaikan / jalur                                                                                          |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| qs6.15.0                                                   | [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw), [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) | qs6.17.1 melalui bodyparser/co-body yang kompatibel                                                                 |
| ip-address10.1.0, melalui Mongo/socks                      | [GHSA-mwp4-54f8-5fhr](https://github.com/advisories/GHSA-mwp4-54f8-5fhr), [GHSA-rxp7-6hxx-x8q5](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5) | 10.7.5; berbeda dari package ipaddr.js                                                                              |
| fast-xml-parser5.5.8, builder1.1.4 pada optional AWS chain | [GHSA-gh4j-gqv2-49f6](https://github.com/advisories/GHSA-gh4j-gqv2-49f6), [GHSA-5wm8-gmm8-39j9](https://github.com/advisories/GHSA-5wm8-gmm8-39j9) | parent @aws-sdk/xml-builder3.972.42 menghapus parser lama; kandidat parser5.11.2/builder1.3.1 jika masih diperlukan |
| source-map-js1.2.1                                         | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)                                                                           | 1.2.2 melalui parent                                                                                                |
| svgo3.3.3                                                  | [GHSA-w27v-7q3p-w38r](https://github.com/advisories/GHSA-w27v-7q3p-w38r)                                                                           | 3.3.5, pertahankan major3                                                                                           |
| esbuild0.27.4                                              | [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr)                                                                           | 0.28.2; kondisi dev-server Windows, project tidak ditemukan memakai serve                                           |
| brace-expansion1.1.13/2.0.3                                | [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | patch1.1.21/2.1.7 sesuai parent                                                                                     |
| minimatch3.1.5/9.0.9                                       | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), CVE-2026-118764                                                          | fixed≥11.0.1; kandidat11.0.3 perlu kompatibilitas parent, tidak override global                                     |
| js-yaml4.1.1                                               | [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh)                                                                           | 4.3.2 compatible patch                                                                                              |

## Target langsung dan batas kompatibilitas

| Area                 | Target snapshot untuk paket implementasi                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Runtime/tooling Node | 24.22.2 LTS, image bookworm-slim terpin digest sesudah verifikasi registry                                                        |
| Mongo server         | 8.0.34, digest terpin; bukan major server upgrade                                                                                 |
| Backend HTTP         | Koa2.16.4 dipertahankan; @koa/router15.7.1, @koa/bodyparser6.1.0                                                                  |
| Mongo driver         | mongodb7.8.0, gunakan BSON/EJSON export driver; hilangkan direct bson4                                                            |
| Backend build        | esbuild0.28.2, svgo3.3.5, TypeScript5.9.3                                                                                         |
| Lint kandidat        | ESLint10.14.0, typescript-eslint8.72.1, flat config yang mempertahankan aturan root                                               |
| Frontend             | Next16.4.3, React/react-dom19.3.1, sharp0.35.5                                                                                    |
| Frontend lint        | @next/eslint-plugin-next16.4.3 + react-hooks7.1.1 + lint kandidat; tanpa full eslint-config-next yang masih menarik plugin peer≤9 |
| Types                | @types/node24.19.2, @types/react19.3.0, @types/react-dom19.3.0                                                                    |
| UI CSS               | CSS variables + CSS Modules; tanpa framework CSS tambahan                                                                         |
| Editor admin         | CodeMirror5.65.21, @types/codemirror5.60.18 melalui React wrapper; lock transitive @types/tern dan audit graph                    |
| HTTPS overlay        | Caddy2.11.7; [release resmi](https://github.com/caddyserver/caddy/releases/tag/v2.11.7), digest/scan gate M01-D                   |
| Test frontend        | Vitest5.0.5, Vite8.3.5, jsdom30.1.3; Testing Library React16.3.3/DOM10.4.2/user-event14.6.8/jest-dom7.0.1; Playwright1.64.1       |
| Observability        | VictoriaLogs1.53.0, Vector0.61.0-debian, image digest diverifikasi saat paket runtime                                             |

Versi TypeScript global terbaru tidak otomatis dipilih: ts-eslint8.72.1
mendukung TS<6.1; TS5.9.3 dipertahankan. Semua direct dependencies yang berubah
dan frontend baru dikunci exact. Root tetap memakai shrinkwrap, frontend
`apps/web/package-lock.json` terpisah; tidak mencampur package manager.

[Node24.22.2](https://nodejs.org/en/blog/release/v24.22.2) terbit28 Oktober.
[Mongo8.0.34](https://www.mongodb.com/docs/v8.0/release-notes/8.0/) memperbaiki
CVE-2026-96297/103965/104004. Preflight menolak kernel Linux6.19–7.0.13 yang
diperingatkan MongoDB, termasuk kernel host Docker; jangan menyimpulkan versi
runtime lama dari tag image floating yang kontainernya berhenti.

Router15.7.1 memuat perbaikan
[GHSA-vm89-r456-25x6](https://github.com/koajs/router/releases/tag/v15.7.1).
Koa3.2.1 tersedia tetapi tidak menjadi syarat keamanan saat ini; pindah major
Koa hanya melalui paket terpisah jika diperlukan.

### Blocker development yang tidak boleh disembunyikan

ESLint10.14.0 masih meminta minimatch^10.2.6; typescript-estree8.72.1 meminta
^10.2.2. Advisory di atas menandai <11.0.1. Mengganti ESLint8 ke10 saja belum
menyelesaikan seluruh graph. ESLint9.39.5/full config Next juga belum
mengatasinya.

Paket M01-A wajib mencatat parent path, severity, penggunaan CLI lokal/CI, serta
versi upstream terbaru. Jika parent patched tersedia, pakai versi compatible
patched dan perbarui tabel. Jika belum, **hentikan penerimaan paket upgrade
tooling** dan buat tiket dependency-blocker dengan bukti. Perubahan scoped
override/lokal patch major hanya melalui PR koreksi rencana yang mencantumkan
API/test parent. Agen murah tidak memilih pengecualian sendiri. Pengembangan
dokumen dan PR backend yang terpisah tetap dapat ditinjau. Tidak ada klaim
seluruh CVE selesai sebelum audit resolved graph.

## Patch frontend Oktober2026

[Pengumuman Next14 Oktober](https://nextjs.org/blog/nextjs-security-update-october-14-2026)
menetapkan fixed16.4.1/15.5.28. Target16.4.3 melewati floor itu.

| Advisory                                                                                                                                                                                                   | Fakta untuk acceptance                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Next GHSA-673q-mjm6-r5xr](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr), [React GHSA-xqc2-xf4c-x3h3](https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3) | RCE typed-array pada RSC/cache; Next16.4.1+, external RSC19.3.1 fixed untuk cabang19.3 |
| [GHSA-2464-fhr4-w9xw](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw), CVE-2026-96889                                                                                           | RCE optimasi SVG Linux/glibc; Next patched dan sharp≥0.35.5                            |
| [GHSA-p3m5-59mp-jv5r](https://github.com/vercel/next.js/security/advisories/GHSA-p3m5-59mp-jv5r), [React GHSA-h3gv-c5rc-p453](https://github.com/react/react/security/advisories/GHSA-h3gv-c5rc-p453)      | DoS Server Actions/Functions; jangan salah melabeli advisory React ini sebagai RCE     |

Paket RSC internal Next16.4.3 tidak mempunyai version field dan memakai peer
label canary vendor. Label itu tidak cukup untuk menilai patch backport.
Acceptance memeriksa rilis Next patched, artifact/SBOM dan paket eksternal.
Jangan menambah override paket RSC internal atau menyatakan `npm ls react`
sebagai satu-satunya bukti. Tidak ada frontend Next lama yang sudah deployed
pada baseline repo ini.

## Regresi wajib saat driver/router diperbarui

1. `lib/cache.ts` findOneAndDelete dan `lib/lock.ts` findOneAndUpdate: tambahkan
   `includeResultMetadata:true` pada options; kode lama membaca `result.value`.
   Uji cache-hit/miss, lock acquire/contend/release/timeout.
2. `lib/db/synth.ts` dan `test/db.ts`: ambil `BSON.EJSON` dari mongodb7, bukan
   direct bson4. Uji ObjectId, date, regex dan filter numeric.
3. Collection.count masih tersedia tetapi deprecated pada driver7.8. Migrasi
   countDocuments boleh dilakukan terpisah; jangan menganggap API tersebut
   hilang lalu mengubah arti filter.
4. GridFS `lib/ui/db.ts`, `lib/nbi.ts`, `lib/fs.ts` memakai string filename ID.
   Pertahankan ID tersebut. Uji upload/download/delete, range, empty file,
   checksum, abort. Callback stream Node bukan callback API Mongo yang dibuang.
5. Semua route sederhana dan suffix `:id.csv` diuji: login/logout/init,
   GET/HEAD/count, encoded ID, trailing slash, CSV-versus-detail,
   401/403/404/405 dan Allow header. Jangan mengarang migrasi inline-regex yang
   tidak ada.
6. HTTP parser: valid JSON/form, body terlalu besar, malformed JSON, multipart
   yang tidak didukung, raw octet-stream file. Body/parser error tersanitasi.

## Gate keamanan dan maintenance

M01 mengerjakan PR terpisah: inventaris+tooling, backend
dependency/compatibility, frontend patched, kemudian runtime/observability.
Jalankan npm ci dalam tooling terisolasi; simpan hash lock sebelum/sesudah, tree
prod/dev, laporan advisory, SBOM dan scan image. Audit kegagalan jaringan adalah
gagal pemeriksaan, bukan temuan nol. Advisory package-version bukan otomatis
bukti exploit.

Release diblokir oleh critical/high runtime/image yang belum ditangani serta
blocker tooling yang belum direview. Setiap pengecualian memerlukan tiket,
alasan reachability, pemilik, mitigasi, tanggal kedaluwarsa dan persetujuan
manusia; agen tidak membuat waiver diam-diam. Satu temuan dapat mempunyai
beberapa dependency path dan seluruh path harus ditelusuri.

Rencana workflow harian `dependency-security.yml` memeriksa graph root/web dan
image, menyimpan artifact, serta membuka/memperbarui satu issue per advisory
tanpa auto-merge. Dependabot mingguan membuat PR terkelompok per subsistem.
Critical/high menjadi tiket prioritas tinggi segera; target triage1hari dan
patch tervalidasi≤72jam adalah sasaran operasi, bukan jaminan upstream patch.
M09 mengaudit ulang sebelum tag rilis. `npm audit fix --force`, pengabaian peer,
dan perintah audit dengan error yang ditelan bukan prosedur upgrade.

## Alert GitHub repository yang wajib masuk rencana

API terautentikasi pada 1 November 2026 menemukan 16 CodeQL open (2 critical, 12
high, 2 medium) dan 1 Dependabot low (esbuild).
[Register dan mapping](github-security-alerts.md) memuat nomor/rule/path/
severity, source commit, tiket dan acceptance.
[Snapshot JSON](github-security-alerts.json) adalah bukti metadata, bukan
konfirmasi exploit.

M01-S1–S9 (ARD-198–ARD-206) masuk setelah M01-B dan sebelum M01-C. Validator
script memakai AST-only Acorn8.19.0 (pin runtime root, lock diaudit), disusul
NBI query allowlist, escaping/XSS, parser/LIKE, cookie CWMP dan crypto per
protokol. Dependabot#1 tetap ARD-165, target esbuild0.28.2≥fixed0.28.1.

Job CodeQL SUCCESS belum membuktikan semua alert tertutup. S9 memeriksa exact
commit/ref, instance/category, pagination/freshness dan review risiko manusia.
Legacy MD5/HMAC-SHA1 tidak diganti sepihak sehingga protokol CPE putus; risiko
yang diterima tetap risk_accepted dengan expiry, bukan fixed. Tidak ada dismiss,
suppression atau perubahan scan pada sesi dokumentasi ini.
