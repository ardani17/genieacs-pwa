# Kebijakan versi dan release fork

Status: keputusan pengguna, 1 November 2026. Dokumen ini merencanakan proses;
tidak membuat tag atau menerbitkan release.

## Urutan versi

Tag stabil fork memakai satu urutan numerik: `v1.2.16` (baseline), `v1.2.17`,
`v1.2.18`, dan seterusnya. Komponen patch bertambah tepat satu. Perombakan UI,
perubahan backend, perubahan tidak kompatibel, dan upgrade major dependency
tetap memakai nomor berikutnya dalam urutan ini. Nomor patch tidak dibatasi dua
digit: `v1.2.99 → v1.2.100`.

Ini kebijakan nomor urut fork, bukan janji kompatibilitas Semantic Versioning.
Perubahan tidak kompatibel diberi bagian **Breaking changes**, langkah migrasi,
backup/restore dan persetujuan release pada changelog. Besar perubahan tidak
disembunyikan oleh nomor patch.

Tag historis upstream yang sudah ada dipertahankan. Pemeriksaan GitHub menemukan
tag `v1.2.16`; endpoint GitHub Release untuk tag tersebut mengembalikan 404 saat
audit. Keberadaan tag dan objek Release adalah dua hal berbeda. Tidak perlu
menerbitkan ulang release historis untuk memulai urutan custom.

## Sumber versi

- `package.json.version` root adalah versi aplikasi fork, tanpa awalan v.
- `npm-shrinkwrap.json.version` dan `packages[""].version` harus sama.
- `apps/web/package.json.version` dan root entry lockfile frontend harus sama
  setelah frontend ditambahkan.
- `release/upstream.json` mencatat baseline engine terpisah:
  `{"tag":"v1.2.16","commit":"38e9dfd0e6dcac51087d11040784fda76ad2460a"}`.
  Import engine upstream berikutnya tidak mengganti nomor rilis fork.
- Build/diagnosis menampilkan `appVersion`, `upstreamVersion`, `commit` dan
  `schemaVersion`. Docker OCI label revision/version serta tag image memakai
  versi fork dan commit.
- Metadata `+tanggalhash` yang sekarang dibuat `build/build.ts` boleh dipakai
  build development, tetapi artifact release menampilkan versi persis tag.
  Tambahkan flag `RELEASE_VERSION` yang divalidasi sama dengan manifest; flag
  kosong mempertahankan metadata development.

Jangan mengambil tag terbaru dari upstream untuk menentukan nomor fork. Ambil
daftar ref remote melalui
`git ls-remote --tags --refs origin 'refs/tags/v1.2.*'`, bukan seluruh tag
lokal. Cocokkan pola `^v1\.2\.(0|[1-9][0-9]*)$`, urutkan komponen patch sebagai
bilangan (bukan string). Semua tag dengan pola ini ikut mengonsumsi nomor,
termasuk tag yang belum mempunyai objek GitHub Release. Riwayat tag adalah
otoritas; record build/Release menjadi bukti penerbitan.

Pembaruan upstream berikutnya masuk namespace `upstream/vX.Y.Z` melalui refspec
yang ditulis di DEVELOPMENT.md, tanpa auto-follow tag biasa. Dengan demikian
`upstream/v1.2.17` dapat berbeda commit dari rilis fork `v1.2.17`. Namespace
upstream tidak ikut menghitung urutan fork. Tag historis yang sudah diwarisi
tetap dipertahankan; jangan push --tags secara membabi buta.

## Prosedur yang akan diimplementasikan pada M09

1. Selesaikan perubahan di branch feature/fix/chore → PR development. Merge
   dokumentasi/fitur biasa tidak menaikkan versi.
2. Buat branch `chore/ard-release-next` dari development. Jalankan
   `node scripts/release/prepare.mjs` setelah fetch tag origin. Skrip membaca
   nomor terakhir, menetapkan tepat next patch, memperbarui manifest/lockfile
   dan membuat `CHANGELOG.md` bagian release. Skrip tidak membuat tag/push.
3. Review PR persiapan ke development, kemudian PR development → main. CI
   `release-sequence` menghitung ulang terhadap tag origin dan memeriksa versi,
   changelog, baseline upstream, serta bahwa tidak ada nomor terlewat.
4. Merge release PR dengan merge commit sesuai workflow repo. Workflow
   `release.yml` dijalankan manual pada commit main yang telah lolos
   pemeriksaan. Satu concurrency group `release-genieacs-pwa`,
   `cancel-in-progress: false` mencegah perlombaan.
5. Workflow fetch ulang origin tags, verifikasi versi tepat next, main ancestry,
   CI sukses, parity, security dan artifact/SBOM/checksum. Build image versi
   exact dan lakukan smoke test sebelum tag. `latest` hanya alias tambahan;
   deployment terpin memakai versi dan digest.
6. Buat annotated tag pada commit main secara atomik melalui GitHub/Git refs
   API; tolak bila ref sudah ada pada commit berbeda. Terbitkan Release yang
   terhubung ke tag itu serta image/checksum/SBOM/migration notes. Tidak ada
   tindakan menerbitkan release dalam tahap planning ini.
7. Buka PR main → development untuk sinkronisasi. Jangan reset/force push kedua
   branch yang dilindungi.

Contoh: terakhir `v1.2.16`, PR persiapan meminta `1.2.17`. Bila sebelum publish
orang lain sudah membuat `v1.2.17`, pemeriksaan ulang berhenti; update PR
berikut menjadi `1.2.18` setelah release/tag17 diverifikasi. Dilarang
menerbitkan18 tanpa keberadaan17.

## Kegagalan dan rollback

- PR/build gagal sebelum tag dibuat: nomor belum dikonsumsi; perbaiki kandidat
  yang sama.
- Tag sudah dibuat, upload Release/image gagal: lanjutkan publish **tag dan
  commit yang sama**, verifikasi checksum; jangan membuat nomor baru hanya untuk
  mengulang upload dan jangan memindahkan/menghapus tag.
- Tag ada pada commit lain: berhenti dan laporkan konflik. Jangan mengganti ref.
- Rilis salah yang sudah terbit: pertahankan sejarah; tarik alias latest bila
  perlu, deploy kembali image/digest lama, perbaiki dengan nomor berikutnya.
- Rollback kode/database mengikuti migration notes; mengubah alias image tidak
  otomatis membalik migrasi data.
- Versi development/PR boleh memakai label image `dev-<commit>` tanpa membuat
  tag stabil/prerelease tambahan.

## Acceptance otomatis

Daftar ref kosong atau kegagalan fetch/ls-remote menghasilkan
`MISSING_RELEASE_BASELINE`/error transport; tidak dianggap patch0 atau audit
sukses. Kandidat tidak boleh diterbitkan sebelum baseline origin dapat dibaca.

`scripts/release/version.mjs` menghasilkan `nextForkVersion(tags): string` dan
`assertReleaseVersion(tags, candidate): void`. Tes
`node --test scripts/release/version.test.mjs` memeriksa minimal:

| Tags/kandidat                                  | Hasil                               |
| ---------------------------------------------- | ----------------------------------- |
| v1.2.14, v1.2.15, v1.2.16 / 1.2.17             | lulus                               |
| sama / 1.2.18                                  | gagal SKIPPED_RELEASE_VERSION       |
| sama / 1.3.0 atau 2.0.0                        | gagal INVALID_RELEASE_LINE          |
| v1.2.9, v1.2.10 / 1.2.11                       | lulus, sort numerik                 |
| v1.2.99 / 1.2.100                              | lulus                               |
| upstream/v1.2.99 dan origin v1.2.16 / 1.2.17   | lulus, namespace upstream diabaikan |
| tag upstream v1.3.0 ada / 1.2.17               | upstream diabaikan untuk urutan     |
| v1.2.17 ada pada commit lain                   | gagal TAG_CONFLICT                  |
| upload ulang v1.2.17 pada commit/checksum sama | resume, tanpa tag baru              |
| manifest/lock/web version berbeda              | gagal VERSION_MISMATCH              |

`SECURITY.md` diubah dalam paket release: dukungan keamanan mengikuti **rilis
fork stabil terakhir**, bukan asumsi semua `1.2.x` didukung. Kerentanan engine
upstream tetap dilaporkan/ditangani terpisah. Tag tidak diubah hanya untuk
menyesuaikan versi Node, MongoDB, Next.js atau upstream GenieACS.
