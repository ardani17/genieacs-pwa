# Pengembangan GenieACS PWA

Repository ini adalah fork `ardani17/genieacs-pwa`. Baseline backend awal
memakai tag upstream `v1.2.16`, commit
`38e9dfd0e6dcac51087d11040784fda76ad2460a`. Frontend Next.js/PWA akan
dikembangkan setelah desainnya ditetapkan. UI saat ini masih UI Mithril dari
GenieACS stable.

## Alur branch

```text
main                           riwayat release
  └── development              integrasi perubahan
        └── feature/<nama>     pengembangan fitur
```

| Branch           | Penggunaan                          | Target pull request |
| ---------------- | ----------------------------------- | ------------------- |
| `main`           | Release yang sudah diverifikasi     | —                   |
| `development`    | Integrasi fitur sebelum release     | `main` saat release |
| `feature/<nama>` | Penambahan fitur                    | `development`       |
| `fix/<nama>`     | Perbaikan bug                       | `development`       |
| `chore/<nama>`   | Perawatan repository dan dependensi | `development`       |

Mulai pekerjaan baru dari `development` yang terbaru:

```sh
git switch development
git pull --ff-only origin development
git switch -c feature/nama-fitur
```

Commit memakai Conventional Commits, misalnya `feat(ui): add device overview`.
Setelah pemeriksaan lulus:

```sh
git push -u origin feature/nama-fitur
gh pr create --repo ardani17/genieacs-pwa --base development
```

Setiap perubahan masuk melalui pull request. CI memeriksa arah branch dan
menjalankan job `verify`. Pull request ke `main` harus berasal dari
`development` pada repository ini. Pull request ke `development` berasal dari
branch fitur, perbaikan, perawatan, atau `main` untuk sinkronisasi setelah
release.

Untuk release, buka pull request `development` ke `main` dan gunakan merge
commit agar hubungan riwayat branch tetap terjaga. Buat tag versi setelah merge
dan verifikasi release. Sesudahnya, sinkronkan `main` kembali ke `development`
melalui pull request agar perbaikan dan merge commit release ikut tercatat.

Branch `master` dan branch bawaan fork lainnya menyimpan riwayat upstream; alur
kerja proyek ini memakai `main`, `development`, dan branch perubahan.

## Remote Git

- `origin`: `https://github.com/ardani17/genieacs-pwa.git`
- `upstream`: `https://github.com/genieacs/genieacs.git`

Pada checkout awal, push default mengarah ke `origin` dan push ke `upstream`
dinonaktifkan. Konfigurasi Git bersifat lokal. Untuk checkout tambahan:

```sh
git remote add upstream https://github.com/genieacs/genieacs.git
git remote set-url --push upstream DISABLED
git config remote.pushDefault origin
git config push.default simple
git config pull.ff only
git config fetch.prune true
git config core.autocrlf false
```

Ambil pembaruan upstream dengan `git fetch upstream --tags`. Evaluasi pembaruan
stable pada branch perubahan dan jalankan pemeriksaan sebelum menggabungkannya.
`upstream/master` adalah jalur pengembangan v1.3; pemindahan versi backend
memerlukan perubahan dan pengujian tersendiri.

## Lingkungan development Docker

Prasyarat: Git dan Docker dengan Compose. Jalankan dari root repository. Tooling
memakai image Node.js 24 dengan digest yang dikunci serta Git untuk metadata
build. Dependensi dan cache npm disimpan dalam volume proyek ini. Compose ini
menyediakan tooling build/test tanpa menjalankan layanan ACS atau database.

```sh
docker compose -f compose.dev.yaml build tooling
docker compose -f compose.dev.yaml run --rm tooling npm ci --no-audit --no-fund
```

Jalankan pemeriksaan berikut sebelum push:

```sh
docker compose -f compose.dev.yaml run --rm tooling npx prettier --check --prose-wrap always .
docker compose -f compose.dev.yaml run --rm tooling npx eslint "bin/*.ts" "lib/**/*.ts" "ui/**/*.ts" "test/**/*.ts" "build/**/*.ts"
docker compose -f compose.dev.yaml run --rm tooling npx tsc --noEmit
docker compose -f compose.dev.yaml run --rm tooling npm test
docker compose -f compose.dev.yaml run --rm tooling npm run build
docker compose -f compose.dev.yaml run --rm tooling node -e "const fs = require('node:fs'); for (const name of ['cwmp', 'nbi', 'fs', 'ui']) { if (!fs.statSync('dist/bin/genieacs-' + name).size) process.exit(1); } for (const suffix of ['.js', '.css']) { if (!fs.readdirSync('dist/public').some(name => name.endsWith(suffix))) process.exit(1); }"
```

Output build ada di `dist/` dan diabaikan Git. Setelah mengubah
manifest/lockfile, jalankan `npm ci` di tooling lagi. `npm run lint` bawaan
upstream menjalankan Prettier dalam mode tulis dan menangkap sebagian error; CI
menjalankan tiap alat secara langsung supaya kegagalan menghasilkan exit code
gagal. Pemeriksaan artifact setelah build memastikan keempat executable dan aset
UI terbentuk; skrip build upstream juga dapat mencetak error tanpa exit code
gagal. Jalankan test dan build secara berurutan.

Untuk memperbaiki format file yang Anda ubah, jalankan Prettier dengan nama file
tersebut, lalu periksa diff. Contoh:

```sh
docker compose -f compose.dev.yaml run --rm tooling npx prettier --write --prose-wrap always docs/DEVELOPMENT.md
```

## Arah pengembangan aplikasi

Dashboard baru direncanakan memakai Next.js dengan API server untuk autentikasi,
otorisasi, validasi operasi, dan mapping perangkat. API mengakses NBI GenieACS
melalui jaringan internal. Dukungan awal mengikuti perangkat ZTE yang tersedia;
profil vendor/model/firmware ditambahkan berdasarkan verifikasi perangkat.

Deployment aplikasi lengkap, seed konfigurasi, HTTPS, dan fitur PWA berada pada
pekerjaan fitur berikutnya. Simpan konfigurasi umum sebagai source versioned;
simpan secret dan data operasional di luar Git. Folder GenieACS lokal yang lama
digunakan sebagai referensi parameter dan perilaku modem.
