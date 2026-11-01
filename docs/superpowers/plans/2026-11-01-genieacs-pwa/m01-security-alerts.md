# GitHub Security Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.
>
> Sesi ini hanya dokumentasi. Paket berstatus Planned; eksekusi hanya ketika
> prasyarat merged, desain ditinjau dan tiket pelaksanaan dipilih. Agen
> low-thinking mengambil satu paket/PR, bukan seluruh milestone sekaligus.

**Goal:** Menangani16alert CodeQL dan1Dependabot yang dilaporkan GitHub, dengan
perubahan kecil, parity terjaga dan bukti scan pada exact commit/ref.

**Architecture:** Parser/input boundary diperbaiki sebelum frontend baru. Native
Authorizer tetap berlaku. Algoritme protokol ditangani per transport; gate
memeriksa status alert, bukan hanya sukses job scanner.

**Tech Stack:** Native TypeScript/Node24.22.2, Acorn8.19.0 (S1), Mongo driver
sesuai M01-B; esbuild0.28.2 ditangani M01-B. Tidak menambah framework UI.

## Global Constraints

- Tahap sekarang docs/planning; source/lock/alert GitHub belum diperbaiki.
- Baca [register alert](../../../design/github-security-alerts.md),
  [kontrak](../../../design/contracts.md) dan
  [indeks43paket](../2026-11-01-genieacs-pwa.md).
- Sembilan paket ini bagian M01, dieksekusi sesudah M01-B dan sebelum M01-C.
- Branch fix per paket dari development terbaru; satu PR, regression dan review.
- Pertahankan native permission, grammar filter yang sah, Inform/session, admin
  script dan kompatibilitas protokol. Perubahan keamanan yang membatasi fitur
  diberi migration notes; tag fork tetap v1.2.N patch+1.
- Bukti scanner adalah kandidat yang perlu validasi batas kepercayaan; jangan
  menyebut semua alert sebagai exploit terkonfirmasi.
- Pengecualian crypto/false-positive membutuhkan reviewer manusia; agen tidak
  mendismiss, menghapus query atau mengganti algorithms untuk menurunkan jumlah.
- Semua tes source/payload menggunakan fixture dummy pada OS sandbox berikut.

## Sandbox dan command bersama

S1 membuat `compose.security-test.yaml`: service security-verify, project
genieacs-pwa-security-check, network_mode:none (hanya loopback namespace
terisolasi), read_only:true, cap_drop:ALL, no-new-privileges, user10001. Source
/source dan toolchain /tools read-only, tmpfs /scratch128MiB mode1777,
mem_limit512MiB, cpus1,pids_limit64, ulimit fsize32MiB/nofile128. Environment
proses dimulai kosong lalu allowlist PATH, NODE_ENV=test, CI=1,
HOME=/scratch/home, TMPDIR=/scratch/tmp; tidak mewarisi env/secrets/socket host.

Runner `scripts/security/check-alerts.mjs <ID>` membundel tes TS ke /scratch
dengan esbuild yang sudah tersedia, menjalankan node --test dengan batas
15detik/test dan wall30detik/suite. Tidak menginstal package/mengakses jaringan
pada test container. Mock Mongo/UDP/XMPP memakai dummy state; integrasi listener
hanya loopback. Wrapper penyiap toolchain/dependency berada di fase build
terpisah yang sudah dipin/audit, bukan proses tes target.

Jika salah satu batas tidak dapat ditegakkan, jangan menjalankan payload atau
test ReDoS di host; laporkan needs_validation dan lengkapi sandbox dahulu.
Output tersanitasi maksimal5MiB dipromosikan launcher tepercaya setelah
container berakhir ke artifacts/security, tanpa membuka artifact retained ke
target. Tes permission native memakai principal fixture dan
deny-before-sideeffect assertion; tidak memakai akun admin/DB/modem sungguhan.

Command setiap paket:

```sh
docker compose -p genieacs-pwa-security-check -f compose.security-test.yaml run --rm security-verify node /source/scripts/security/check-alerts.mjs M01-S1
```

Ganti ID terakhir sesuai heading paket. Expected awal: assertion perilaku gagal
atau modul baru belum tersedia, bukan error infrastruktur. Sesudah perubahan:
PASS; batas waktu/resource tidak terlampaui; log/event tidak mengandung marker
secret. S1 membangun sandbox/runner dahulu, lalu menjalankan tes red.

Pemeriksaan akhir memakai format/lint/type/build pada CI yang ditetapkan indeks.
Riset/task sekarang tidak menjalankan target tests. Authenticated fetch alert
hanya metadata read; tidak melakukan pengujian serangan ke GitHub/deployment.

## M01-S1 — Validasi sintaks provision tanpa kompilasi executable

**Linear:**
[ARD-198](https://linear.app/ardani/issue/ARD-198/m01-s1-validasi-sintaks-provision-tanpa-kompilasi-executable).
**Status:** Planned/Backlog. **Prasyarat:** ARD-165 merged. **Branch:**
`fix/m01-s1`. **Alert:**
[#9](https://github.com/ardani17/genieacs-pwa/security/code-scanning/9),
[#10](https://github.com/ardani17/genieacs-pwa/security/code-scanning/10).

**Read set:**

- `lib/ui/db.ts`
- `lib/ui/api.ts`
- `lib/common/authorizer.ts`
- `lib/sandbox.ts`
- `docs/design/github-security-alerts.md`

**Write set (buat jika belum ada):**

- `lib/ui/script-validation.ts`
- `lib/ui/db.ts`
- `test/security/script-validation.ts`
- `test/security/script-permissions.ts`
- `package.json`
- `npm-shrinkwrap.json`
- `compose.security-test.yaml`
- `scripts/security/check-alerts.mjs`
- `scripts/check-suites.json`

**Interfaces:** validateAdminScript(script:string,id:string):void; throws
VALIDATION dengan line/column aman. Fungsi hanya parse AST, tidak
mengompilasi/menjalankan script. Auth tetap native sebelum parser/store.

### Langkah

- [ ] Periksa prasyarat/read set dan buat branch `fix/m01-s1` dari development
      terbaru. Baseline kegagalan di luar paket dihentikan/dicatat.
- [ ] Tambahkan assertion pertama berikut pada file test write set yang sesuai.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { validateAdminScript } from "../../lib/ui/script-validation.ts";
test("syntax validation never executes submitted JavaScript", () => {
  delete globalThis["fixtureMarker"];
  validateAdminScript(
    'globalThis.fixtureMarker = "executed"; return 1;',
    "fixture",
  );
  assert.equal(globalThis["fixtureMarker"], undefined);
  assert.throws(() => validateAdminScript("return (", "fixture"), /VALIDATION/);
});
```

- [ ] Jalankan suite sandbox ID `M01-S1`; expected red pada perilaku/modul yang
      sedang diperbaiki, lalu lakukan perubahan satu per satu:

- [ ] Tambahkan acorn8.19.0 exact ke runtime dependency (metadata npm primer,
      tanpa dependency transitif); resolve lock dan audit graph di tooling
      terisolasi. M01-B harus mempertahankan pin ini.
- [ ] Parse string wrapper yang sama dengan sebelumnya: strict directive dan
      function body, ecmaVersion2022/sourceType script. Batas script256KiB UTF8
      dan ID256karakter; error publik hanya tipe/line/column, tanpa isi
      script/stack. Script disimpan tetap asli.
- [ ] Ganti dua new Script pada putProvision/putVirtualParameter dengan
      validateAdminScript; hapus import vm bila sudah tak dipakai. Larang
      eval/Function/compileFunction sebagai pengganti validator. Jangan mengubah
      eksekusi engine sandbox sebagai bagian paket.
- [ ] Uji actual Authorizer resource write/filter/validator: operator tanpa izin
      ditolak sebelum parse maupun DB write. Syntax valid yang menyebut
      require/process tidak dieksekusi saat save; authorization script admin
      tetap fitur yang sengaja ada.
- [ ] Buat compose.security-test dan runner terisolasi menurut aturan pengujian
      dokumen ini. Paket berikut memakai runner yang sama; test AST memakai mock
      persistence dan dummy principals. Catat event
      admin.script.validation_failed hanya ID/kode/ukuran, tanpa source.

- [ ] Jalankan acceptance lengkap, code path positif/negatif dan pemeriksaan
      log.

**Acceptance:** Valid script+return diterima/round-trip; syntax invalid
memberi400, oversize413/VALIDATION tanpa write; denied403 tanpa write; marker
tak berubah; dua sink alert#9/#10 hilang pada scan commit implementasi. Engine
tidak diklaim sandbox keamanan multi-tenant; menjalankan provision tetap hak
admin tepercaya.

```sh
docker compose -p genieacs-pwa-security-check -f compose.security-test.yaml run --rm security-verify node /source/scripts/security/check-alerts.mjs M01-S1
git diff --check
```

Expected PASS, tidak ada efek samping/secret/timeout yang tak diharapkan.
Daftarkan suite pada scripts/check-suites.json dan runner security; artefak
wajib tidak boleh kosong. Hasil scanner harus menyebut commit dan ref.

- [ ] Review diff, commit hanya write set, push branch dan PR development: judul
      `[ARD-198] M01-S1 — Validasi sintaks provision tanpa kompilasi executable`,
      body-file memuat alert URL, hasil tes, log redaction, compatibility, scan
      dan risiko tersisa. Commit
      `fix(security): validasi sintaks provision tanpa kompilasi executable`.
      Tiket In Review setelah PR; Done setelah acceptance+merge. State alert
      GitHub belum dianggap fixed tanpa scan ref yang benar.

**Stop / pemulihan:** Jika parser AST menolak syntax yang diterima strict
wrapper baseline pada fixture parity, hentikan untuk koreksi parser
option/fixture, bukan menjalankan script untuk validasi. Temuan di engine
sandbox di luar dua sink menjadi tiket tersendiri. Rollback hanya perubahan
branch paket; tidak reset branch protected, tidak mengubah
rute/volume/kernel/reference.

---

## M01-S2 — Batasi grammar query NBI sebelum akses MongoDB

**Linear:**
[ARD-199](https://linear.app/ardani/issue/ARD-199/m01-s2-batasi-grammar-query-nbi-sebelum-akses-mongodb).
**Status:** Planned/Backlog. **Prasyarat:** ARD-198 merged. **Branch:**
`fix/m01-s2`. **Alert:**
[#7](https://github.com/ardani17/genieacs-pwa/security/code-scanning/7),
[#8](https://github.com/ardani17/genieacs-pwa/security/code-scanning/8).

**Read set:**

- `lib/nbi.ts`
- `lib/query.ts`
- `lib/db/db.ts`
- `test/db.ts`

**Write set (buat jika belum ada):**

- `lib/nbi-query.ts`
- `lib/nbi.ts`
- `test/security/nbi-query.ts`
- `test/security/nbi-route.ts`
- `scripts/check-suites.json`

**Interfaces:** validateNbiQuery(value:unknown):Record<string,unknown>;
parseNbiListOptions(search:URLSearchParams):{filter,projection,sort,skip,limit};
throw VALIDATION sebelum find/countDocuments.

### Langkah

- [ ] Periksa prasyarat/read set dan buat branch `fix/m01-s2` dari development
      terbaru. Baseline kegagalan di luar paket dihentikan/dicatat.
- [ ] Tambahkan assertion pertama berikut pada file test write set yang sesuai.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { validateNbiQuery } from "../../lib/nbi-query.ts";
test("server-side executable operators never reach Mongo", () => {
  assert.throws(
    () => validateNbiQuery({ $where: "return true" }),
    /VALIDATION/,
  );
  assert.throws(
    () => validateNbiQuery({ x: { $function: { body: "return true" } } }),
    /VALIDATION/,
  );
  assert.deepEqual(validateNbiQuery({ SerialNumber: { $eq: "TEST-001" } }), {
    SerialNumber: { $eq: "TEST-001" },
  });
});
```

- [ ] Jalankan suite sandbox ID `M01-S2`; expected red pada perilaku/modul yang
      sedang diperbaiki, lalu lakukan perubahan satu per satu:

- [ ] Closed grammar: root plain object; logical
      $and/$or/$nor arrays1..100 dan $not field-only; field operators $eq/$ne/$gt/$gte/$lt/$lte/$in/$nin/$exists/$type/$regex/$options/$not/$elemMatch.
      Tolak $where/$function/$accumulator/$expr dan unknown operators, prototype
      keys **proto**/constructor/prototype pada semua kedalaman.
- [ ] Batas input query8192byte, depth10, nodes1000, field path≤256,
      $in/$nin≤100nilai, sort≤8field direction±1, projection≤100field, skip
      integer0..1000000, limit1..10000. Compatibility missing limit tetap10000
      dengan catatan migration; browser BFF tetap page≤100.
- [ ] Regex NBI hanya pattern≤256 dengan flag i/m; tolak
      backreference/lookaround/nested quantifier atau fitur di luar subset
      linear yang didokumentasikan. Jangan mengubah string regex menjadi
      executable. Mongo maxTimeMS5000 pada find dan count; syntax/operator
      error400, time budget503/504.
- [ ] Periksa collection dengan Object.hasOwn(collections,name), bukan prototype
      lookup. Preserve daftar resource collection yang telah ada; jangan
      memperluas akses NBI ke publik. Validasi input sebelum
      query.expand/sanitize; validasi hasil ekspansi lagi sebelum driver.
- [ ] Fake collection spies membuktikan reject tidak memanggil find/count; valid
      fixtures membuktikan filter/projection/count/HEAD konsisten. Test routing
      actual listener dengan dummy collection/loopback terisolasi. Log hanya
      rejected field/operator/kode, tanpa query berisi secret.

- [ ] Jalankan acceptance lengkap, code path positif/negatif dan pemeriksaan
      log.

**Acceptance:** Alert#7 dan#8 dilacak bersama, find maupun count aman. Root
array/null, nested executable operator, prototype key, invalidsort, regex
berbahaya dan limit tak hingga ditolak. Query devices/task/fault yang sah,
ObjectId/date conversion, GET/HEAD/count/filter tetap lulus.

```sh
docker compose -p genieacs-pwa-security-check -f compose.security-test.yaml run --rm security-verify node /source/scripts/security/check-alerts.mjs M01-S2
git diff --check
```

Expected PASS, tidak ada efek samping/secret/timeout yang tak diharapkan.
Daftarkan suite pada scripts/check-suites.json dan runner security; artefak
wajib tidak boleh kosong. Hasil scanner harus menyebut commit dan ref.

- [ ] Review diff, commit hanya write set, push branch dan PR development: judul
      `[ARD-199] M01-S2 — Batasi grammar query NBI sebelum akses MongoDB`,
      body-file memuat alert URL, hasil tes, log redaction, compatibility, scan
      dan risiko tersisa. Commit
      `fix(security): batasi grammar query nbi sebelum akses mongodb`. Tiket In
      Review setelah PR; Done setelah acceptance+merge. State alert GitHub belum
      dianggap fixed tanpa scan ref yang benar.

**Stop / pemulihan:** Jika integrasi NBI existing memakai operator yang ditolak,
catat breaking change dan contoh migrasi aman. Tidak melemahkan allowlist agar
alert diam; tidak mengganti NBI dengan koneksi DB browser. Rollback hanya
perubahan branch paket; tidak reset branch protected, tidak mengubah
rute/volume/kernel/reference.

---

## M01-S3 — Escaping menyeluruh dan error response tanpa HTML

**Linear:**
[ARD-200](https://linear.app/ardani/issue/ARD-200/m01-s3-escaping-menyeluruh-dan-error-response-tanpa-html).
**Status:** Planned/Backlog. **Prasyarat:** ARD-199 merged. **Branch:**
`fix/m01-s3`. **Alert:**
[#1](https://github.com/ardani17/genieacs-pwa/security/code-scanning/1),
[#2](https://github.com/ardani17/genieacs-pwa/security/code-scanning/2),
[#4](https://github.com/ardani17/genieacs-pwa/security/code-scanning/4),
[#5](https://github.com/ardani17/genieacs-pwa/security/code-scanning/5),
[#6](https://github.com/ardani17/genieacs-pwa/security/code-scanning/6).

**Read set:**

- `lib/query.ts`
- `lib/ui/api.ts`
- `lib/util.ts`
- `test/util.ts`

**Write set (buat jika belum ada):**

- `lib/query.ts`
- `lib/ui/api.ts`
- `lib/ui/safe-error.ts`
- `test/security/escaping.ts`
- `test/security/error-response.ts`
- `scripts/check-suites.json`

**Interfaces:** escapeWildcardLiteral(input:string):string;
quoteCsvCell(value:unknown):string;
sendSafeLegacyError(ctx,status,code,message):void sets text/plain. API legacy
mempertahankan bentuk string, BFF tetap ApiResult.

### Langkah

- [ ] Periksa prasyarat/read set dan buat branch `fix/m01-s3` dari development
      terbaru. Baseline kegagalan di luar paket dihentikan/dicatat.
- [ ] Tambahkan assertion pertama berikut pada file test write set yang sesuai.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { quoteCsvCell } from "../../lib/ui/safe-error.ts";
test("CSV escapes every double quote", () => {
  assert.equal(quoteCsvCell('a"b"c'), '"a""b""c"');
});
```

- [ ] Jalankan suite sandbox ID `M01-S3`; expected red pada perilaku/modul yang
      sedang diperbaiki, lalu lakukan perubahan satu per satu:

- [ ] Ganti replace satu kejadian pada query.ts dengan escaping seluruh
      metacharacter. Tokenize wildcard _ terpisah; seluruh _ internal
      dikonversi, run \* berulang diringkas. Jangan meng-escape hasil regex dua
      kali.
- [ ] Pertahankan perilaku wildcard leading/trailing dan anchor; test
      dua+bracket/backslash/dot/plus/star, input literal tanpa \*, Unicode dan
      fixture query.expand. Regex literal eksplisit tetap mengikuti grammar aman
      S2.
- [ ] CSV header/value menggunakan satu helper untuk quote seluruh tanda petik
      serta pemisah koma/CRLF; formula protection rencana BFF tetap berlaku.
      Helper tidak mencetak credential.
- [ ] Error delete/put route memberi ctx.type=text/plain;charset=utf-8, nosniff,
      message allowlist+requestId; err.name/message mentah hanya logger
      tersanitasi. Jangan mengembalikan HTML atau men-escape sekali lalu tetap
      auto-infer HTML.
- [ ] Negative UI/API tests mengandung text <img ...> sebagai fixture inert;
      assert Content-Type text/plain dan DOM tidak membentuk elemen/script.
      ResourceLockedError503 tetap spesifik aman; validation400 dan
      permission403 tidak berubah.

- [ ] Jalankan acceptance lengkap, code path positif/negatif dan pemeriksaan
      log.

**Acceptance:** Lima alert#1/#2/#4/#5/#6 mendapat testID, bukan hanya UI Next
diperbaiki. CSV multi-quote round-trip, wildcard banyak metacharacter tidak
mengubah maksud filter; raw error stack/body tidak masuk response/log.

```sh
docker compose -p genieacs-pwa-security-check -f compose.security-test.yaml run --rm security-verify node /source/scripts/security/check-alerts.mjs M01-S3
git diff --check
```

Expected PASS, tidak ada efek samping/secret/timeout yang tak diharapkan.
Daftarkan suite pada scripts/check-suites.json dan runner security; artefak
wajib tidak boleh kosong. Hasil scanner harus menyebut commit dan ref.

- [ ] Review diff, commit hanya write set, push branch dan PR development: judul
      `[ARD-200] M01-S3 — Escaping menyeluruh dan error response tanpa HTML`,
      body-file memuat alert URL, hasil tes, log redaction, compatibility, scan
      dan risiko tersisa. Commit
      `fix(security): escaping menyeluruh dan error response tanpa html`. Tiket
      In Review setelah PR; Done setelah acceptance+merge. State alert GitHub
      belum dianggap fixed tanpa scan ref yang benar.

**Stop / pemulihan:** Jika perubahan quoting mengubah existing filter
legitimate, tambahkan fixture dan perbaiki tokenizer. Jangan suppress rule
incomplete-sanitization atau membungkus semua error menjadi200. Rollback hanya
perubahan branch paket; tidak reset branch protected, tidak mengubah
rute/volume/kernel/reference.

---

## M01-S4 — Parser string linear dan pola LIKE yang literal

**Linear:**
[ARD-201](https://linear.app/ardani/issue/ARD-201/m01-s4-parser-string-linear-dan-pola-like-yang-literal).
**Status:** Planned/Backlog. **Prasyarat:** ARD-200 merged. **Branch:**
`fix/m01-s4`. **Alert:**
[#3](https://github.com/ardani17/genieacs-pwa/security/code-scanning/3),
[#15](https://github.com/ardani17/genieacs-pwa/security/code-scanning/15).

**Read set:**

- `lib/common/expression/parser.ts`
- `lib/common/expression/util.ts`
- `lib/db/synth.ts`
- `lib/common/expression/synth.ts`

**Write set (buat jika belum ada):**

- `lib/common/expression/parser.ts`
- `lib/common/expression/util.ts`
- `test/security/expression-parser.ts`
- `test/security/like-pattern.ts`
- `scripts/check-suites.json`

**Interfaces:**
readQuotedJsString(text:string,start:number):{raw:string,end:number};
likePatternToRegExp(pat,esc,flags) signature existing dipertahankan. Matcher
input dari token escaped, bukan source regex user.

### Langkah

- [ ] Periksa prasyarat/read set dan buat branch `fix/m01-s4` dari development
      terbaru. Baseline kegagalan di luar paket dihentikan/dicatat.
- [ ] Tambahkan assertion pertama berikut pada file test write set yang sesuai.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { likePatternToRegExp } from "../../lib/common/expression/util.ts";
test("LIKE metacharacters and backslashes remain literal", () => {
  assert.equal(likePatternToRegExp("a.b").test("axb"), false);
  assert.equal(likePatternToRegExp("a.b").test("a.b"), true);
  assert.equal(likePatternToRegExp("a\\\\b").test("a/b"), false);
});
```

- [ ] Jalankan suite sandbox ID `M01-S4`; expected red pada perilaku/modul yang
      sedang diperbaiki, lalu lakukan perubahan satu per satu:

- [ ] Ganti regex StringValueJs ber-backtracking dengan scanner satu lintasan:
      mulai quote, backslash melewati satu karakter, stop pada quote tak
      ter-escape; EOF/trailing escape/newline literal gagal dengan index.
      interpretEscapes baseline tetap dipakai agar \n/\u dan SQL string parity.
- [ ] LIKE tokenize membedakan literal, %, \_ dan escape. Quote setiap literal
      melalui escape regex standar untuk SEMUA karakter; perbaiki literal
      backslash yang sekarang dipetakan ke slash. SQL wildcard sengaja
      diterjemahkan, bukan dianggap regex injection.
- [ ] Pattern length≤4096, wildcard count≤32, flags allowlist i/m/u tanpa g/y.
      Preserve leading/trailing % semantics dan collapse consecutive %.
      Evaluator LIKE/NOT LIKE serta Mongo synthesis menerima token yang sama;
      tolak budget berlebih dengan error terkontrol.
- [ ] Tambah pengujian bounded malformed input8/16/32KiB dalam child
      timeout1000ms dan OS limit, tanpa menjalankan regex berbahaya di host.
      Assertion scanner visitedChars≤inputLength+1 mengukur linearity; tidak
      mengandalkan wall clock saja.
- [ ] Tests compare evaluate LIKE/NOT LIKE dengan query synthesis fixtures,
      escaped wildcard %, \_, backslash, Unicode serta quote escape. Jangan
      mengganti seluruh dynamic expression language atau menghilangkan fitur.

- [ ] Jalankan acceptance lengkap, code path positif/negatif dan pemeriksaan
      log.

**Acceptance:** Alert#15 sink regex lama dihapus; #3 menghasilkan pattern dari
literal escaped/token yang diaudit. Uji multiple quote/backslash,
missingclosingquote, valid SQL/JS strings, regex chars tidak menyuntik
alternation/quantifier, bounded rejection dan normal parser suite lulus.

```sh
docker compose -p genieacs-pwa-security-check -f compose.security-test.yaml run --rm security-verify node /source/scripts/security/check-alerts.mjs M01-S4
git diff --check
```

Expected PASS, tidak ada efek samping/secret/timeout yang tak diharapkan.
Daftarkan suite pada scripts/check-suites.json dan runner security; artefak
wajib tidak boleh kosong. Hasil scanner harus menyebut commit dan ref.

- [ ] Review diff, commit hanya write set, push branch dan PR development: judul
      `[ARD-201] M01-S4 — Parser string linear dan pola LIKE yang literal`,
      body-file memuat alert URL, hasil tes, log redaction, compatibility, scan
      dan risiko tersisa. Commit
      `fix(security): parser string linear dan pola like yang literal`. Tiket In
      Review setelah PR; Done setelah acceptance+merge. State alert GitHub belum
      dianggap fixed tanpa scan ref yang benar.

**Stop / pemulihan:** Jika CodeQL tetap menandai helper builder, lampirkan
invariant/token flow dan hasil scan ke review S9; jangan menonaktifkan
rule/globalfile. Penilaian false-positive hanya reviewer manusia. Rollback hanya
perubahan branch paket; tidak reset branch protected, tidak mengubah
rute/volume/kernel/reference.

---

## M01-S5 — Parser cookie CWMP satu lintasan tanpa ReDoS

**Linear:**
[ARD-202](https://linear.app/ardani/issue/ARD-202/m01-s5-parser-cookie-cwmp-satu-lintasan-tanpa-redos).
**Status:** Planned/Backlog. **Prasyarat:** ARD-201 merged. **Branch:**
`fix/m01-s5`. **Alert:**
[#16](https://github.com/ardani17/genieacs-pwa/security/code-scanning/16).

**Read set:**

- `lib/cwmp.ts`
- `lib/auth.ts`

**Write set (buat jika belum ada):**

- `lib/cwmp-cookie.ts`
- `lib/cwmp.ts`
- `test/security/cwmp-cookie.ts`
- `scripts/check-suites.json`

**Interfaces:** getCwmpSessionId(cookie:string|undefined):string|undefined;
maximum8192byte, singlepass ';' dan ',' separators; last valid session wins
seperti baseline.

### Langkah

- [ ] Periksa prasyarat/read set dan buat branch `fix/m01-s5` dari development
      terbaru. Baseline kegagalan di luar paket dihentikan/dicatat.
- [ ] Tambahkan assertion pertama berikut pada file test write set yang sesuai.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { getCwmpSessionId } from "../../lib/cwmp-cookie.ts";
test("CPE comma cookies and quoted session remain compatible", () => {
  assert.equal(getCwmpSessionId('other=x, session="TEST-1"; foo=y'), "TEST-1");
  assert.equal(getCwmpSessionId(undefined), undefined);
});
```

- [ ] Jalankan suite sandbox ID `M01-S5`; expected red pada perilaku/modul yang
      sedang diperbaiki, lalu lakukan perubahan satu per satu:

- [ ] Extract parsing sebelum listener membentuk session. Split/scan delimiter
      ,/; sekali, trim ASCII whitespace, first '='; key/value hanya alnum/\_/-,
      optional pair doublequote, emptyvalue mengikuti baseline; malformed pair
      diabaikan.
- [ ] Header>8192byte ditolak HTTP431 sebelum regex/session/DB, tanpa menulis
      raw header ke log. Missing cookie dianggap tidak ada session dan tetap
      dapat memulai Inform normal.
- [ ] Gunakan bounded char loop, tanpa nested/lazy regex dan tanpa repeated
      slicing quadratic. Track start/end indeks, ambil string paling akhir
      setelah valid.
- [ ] Uji compatibility corpus dari baseline: comma-separated CPE, quote,
      banyakcookie, duplicate session lastvalid, invalid token, whitespace,
      emptyheader; panjang8/16/32KiB timeout terisolasi.

- [ ] Jalankan acceptance lengkap, code path positif/negatif dan pemeriksaan
      log.

**Acceptance:** Alert#16 tidak lagi mempunyai regex lama; malformed input tidak
membuat event loop macet. Inform/session/overload response tetap berfungsi pada
fixture, request oversized431 dengan kode aman.

```sh
docker compose -p genieacs-pwa-security-check -f compose.security-test.yaml run --rm security-verify node /source/scripts/security/check-alerts.mjs M01-S5
git diff --check
```

Expected PASS, tidak ada efek samping/secret/timeout yang tak diharapkan.
Daftarkan suite pada scripts/check-suites.json dan runner security; artefak
wajib tidak boleh kosong. Hasil scanner harus menyebut commit dan ref.

- [ ] Review diff, commit hanya write set, push branch dan PR development: judul
      `[ARD-202] M01-S5 — Parser cookie CWMP satu lintasan tanpa ReDoS`,
      body-file memuat alert URL, hasil tes, log redaction, compatibility, scan
      dan risiko tersisa. Commit
      `fix(security): parser cookie cwmp satu lintasan tanpa redos`. Tiket In
      Review setelah PR; Done setelah acceptance+merge. State alert GitHub belum
      dianggap fixed tanpa scan ref yang benar.

**Stop / pemulihan:** Jika device lab memakai format di luar corpus, simpan
contoh tersanitasi dan revisi tokenizer; jangan kembalikan regex vulnerable atau
log cookie asli. Rollback hanya perubahan branch paket; tidak reset branch
protected, tidak mengubah rute/volume/kernel/reference.

---

## M01-S6 — HTTP Digest: algoritme benar dan batas legacy MD5

**Linear:**
[ARD-203](https://linear.app/ardani/issue/ARD-203/m01-s6-http-digest-algoritme-benar-dan-batas-legacy-md5).
**Status:** Planned/Backlog. **Prasyarat:** ARD-202 merged. **Branch:**
`fix/m01-s6`. **Alert:**
[#11](https://github.com/ardani17/genieacs-pwa/security/code-scanning/11).

**Read set:**

- `lib/auth.ts`
- `lib/cwmp.ts`
- `lib/connection-request.ts`
- `test/auth.ts`

**Write set (buat jika belum ada):**

- `lib/auth.ts`
- `lib/cwmp.ts`
- `lib/connection-request.ts`
- `test/security/http-digest.ts`
- `docs/operations/legacy-protocol-crypto.md`
- `scripts/check-suites.json`

**Interfaces:** DigestAlgorithm='MD5'|'SHA-256'|'MD5-sess'|'SHA-256-sess';
digest(...existingArgs,algorithm?:DigestAlgorithm):string; parameter baru
terakhir agar caller lama tetap kompatibel.

### Langkah

- [ ] Periksa prasyarat/read set dan buat branch `fix/m01-s6` dari development
      terbaru. Baseline kegagalan di luar paket dihentikan/dicatat.
- [ ] Tambahkan assertion pertama berikut pada file test write set yang sesuai.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { solveDigest, parseAuthorizationHeader } from "../../lib/auth.ts";
test("unsupported advertised algorithm is never silently computed as MD5", () => {
  assert.throws(
    () =>
      solveDigest("fixture", "fixture", "/", "GET", "", {
        method: "Digest",
        realm: "test",
        nonce: "test",
        algorithm: "UNKNOWN",
      }),
    /algorithm/i,
  );
});
```

- [ ] Jalankan suite sandbox ID `M01-S6`; expected red pada perilaku/modul yang
      sedang diperbaiki, lalu lakukan perubahan satu per satu:

- [ ] Pertahankan default absentalgorithm=MD5 untuk legacy challenge; explicit
      SHA-256 harus benar-benar memakai SHA256. Jangan menyalin algorithm label
      challenge tetapi tetap menghitung MD5 seperti source sekarang.
- [ ] Implement formula RFC7616 untuk digest/auth/auth-int dan sess dari hash
      yang dipilih; allowlist algoritme, unknownditolak. Challenge negotiation
      memilih strongest supported yang memang di-advertise; inbound CWMP
      mempertahankan compatibility MD5 sampai migrasi disetujui.
- [ ] Tambah known-answer vector RFC7616 untuk SHA256/MD5, existing test/auth
      tetap lulus, negative mismatch/bodytamper/qop/nonce. Password dashboard
      PBKDF2sha512 bukan sink MD5 ini dan tidak diganti oleh paket.
- [ ] Isolasi legacy MD5 di helper bernama protocol-only, catat alasan
      interoperabilitas dan jumlah penggunaan tanpa credential. Network
      isolate/HTTPS bila didukung dan kebijakan admin legacy yang jelas;
      menghapus MD5 total memerlukan lab CPE.
- [ ] Alert#11 yang tetap muncul setelah hardening bukan otomatis fixed; S9
      meminta review manusia atas residual protocol risk dan expiry mitigasi
      sebelum release. Agent tidak mendismiss.

- [ ] Jalankan acceptance lengkap, code path positif/negatif dan pemeriksaan
      log.

**Acceptance:** Digest label/hash konsisten, SHA256vectors dan MD5compatibility
lulus, unsupportedalg gagal. HTTP CWMP dan outgoing CR keduanya dicakup.
Residual MD5 didokumentasikan sebagai open/accepted oleh manusia, bukan diganti
lemah secara tersembunyi.

```sh
docker compose -p genieacs-pwa-security-check -f compose.security-test.yaml run --rm security-verify node /source/scripts/security/check-alerts.mjs M01-S6
git diff --check
```

Expected PASS, tidak ada efek samping/secret/timeout yang tak diharapkan.
Daftarkan suite pada scripts/check-suites.json dan runner security; artefak
wajib tidak boleh kosong. Hasil scanner harus menyebut commit dan ref.

- [ ] Review diff, commit hanya write set, push branch dan PR development: judul
      `[ARD-203] M01-S6 — HTTP Digest: algoritme benar dan batas legacy MD5`,
      body-file memuat alert URL, hasil tes, log redaction, compatibility, scan
      dan risiko tersisa. Commit
      `fix(security): http digest: algoritme benar dan batas legacy md5`. Tiket
      In Review setelah PR; Done setelah acceptance+merge. State alert GitHub
      belum dianggap fixed tanpa scan ref yang benar.

**Stop / pemulihan:** Jika CPE hanya MD5, jangan memutus seluruh ACS untuk
membuat angka alert nol. Pertahankan compatibility dan gate release menunggu
reviewer risiko/lab; tidak menonaktifkan scan. Rollback hanya perubahan branch
paket; tidak reset branch protected, tidak mengubah
rute/volume/kernel/reference.

---

## M01-S7 — UDP Connection Request: HMAC protokol dan nonce aman

**Linear:**
[ARD-204](https://linear.app/ardani/issue/ARD-204/m01-s7-udp-connection-request-hmac-protokol-dan-nonce-aman).
**Status:** Planned/Backlog. **Prasyarat:** ARD-203 merged. **Branch:**
`fix/m01-s7`. **Alert:**
[#12](https://github.com/ardani17/genieacs-pwa/security/code-scanning/12).

**Read set:**

- `lib/connection-request.ts`
- `docs/operations/legacy-protocol-crypto.md`

**Write set (buat jika belum ada):**

- `lib/connection-request.ts`
- `lib/udp-cr-auth.ts`
- `test/security/udp-cr-auth.ts`
- `docs/operations/legacy-protocol-crypto.md`
- `scripts/check-suites.json`

**Interfaces:**
buildUdpCrSignature({timestamp,id,username,cnonce,password}):string;
generateUdpCrId():number uses crypto.randomInt(0,2\*\*32), wire HMAC-SHA1 sesuai
TR069AnnexG.

### Langkah

- [ ] Periksa prasyarat/read set dan buat branch `fix/m01-s7` dari development
      terbaru. Baseline kegagalan di luar paket dihentikan/dicatat.
- [ ] Tambahkan assertion pertama berikut pada file test write set yang sesuai.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildUdpCrSignature } from "../../lib/udp-cr-auth.ts";
test("UDP CR signature preserves 40 hex characters required by CPE", () => {
  const sig = buildUdpCrSignature({
    timestamp: 1,
    id: 2,
    username: "fixture",
    cnonce: "fixture",
    password: "fixture",
  });
  assert.match(sig, /^[0-9a-f]{40}$/);
});
```

- [ ] Jalankan suite sandbox ID `M01-S7`; expected red pada perilaku/modul yang
      sedang diperbaiki, lalu lakukan perubahan satu per satu:

- [ ] HMAC-SHA1 pada UDP CR adalah wire requirement TR069AnnexG, berbeda dari
      passwordhash. Extract protocol-only helper, input concatenation persis
      ts+id+un+cn, jangan menggantiSHA256 yang tak didukung modem.
- [ ] Ganti Math.random message ID dengan crypto.randomInt uint32. Cnonce tetap
      randomBytes8, timestamp integerseconds; validate
      targetfromauthorizeddevice/no arbitrarypublicprobe.
- [ ] Test known-answer HMAC fixture dari standar/independentcalculation,
      URIencodingusername, no newline injection, port/hostvalidation, retrywire
      behavior baseline. Fake UDPsocket, tidak mengirim datagram nyata.
- [ ] Jangan log URI sig/un/credential atau HMACkey; event hanya
      deviceId/transport/duration/result. Residual alert#12 masuk review manusia
      S9 dengan rujukanstandar dan scopelegacy, bukan mendismissotomatis.

- [ ] Jalankan acceptance lengkap, code path positif/negatif dan pemeriksaan
      log.

**Acceptance:** Wire40hex dan signatureyangditerimamodem terjaga; CSPRNG
messageID; no secret log; malformedtarget error. Keamanan HMAC tidak disimpulkan
hanya dari kelemahan collision SHA1.

```sh
docker compose -p genieacs-pwa-security-check -f compose.security-test.yaml run --rm security-verify node /source/scripts/security/check-alerts.mjs M01-S7
git diff --check
```

Expected PASS, tidak ada efek samping/secret/timeout yang tak diharapkan.
Daftarkan suite pada scripts/check-suites.json dan runner security; artefak
wajib tidak boleh kosong. Hasil scanner harus menyebut commit dan ref.

- [ ] Review diff, commit hanya write set, push branch dan PR development: judul
      `[ARD-204] M01-S7 — UDP Connection Request: HMAC protokol dan nonce aman`,
      body-file memuat alert URL, hasil tes, log redaction, compatibility, scan
      dan risiko tersisa. Commit
      `fix(security): udp connection request: hmac protokol dan nonce aman`.
      Tiket In Review setelah PR; Done setelah acceptance+merge. State alert
      GitHub belum dianggap fixed tanpa scan ref yang benar.

**Stop / pemulihan:** Protokol pengganti memerlukan dukunganCPE/lab dan revisi
desain; jangan mengganti algoritme sepihak atau menyebut warningfalsepositive
tanpa analisis/reviewer. Rollback hanya perubahan branch paket; tidak reset
branch protected, tidak mengubah rute/volume/kernel/reference.

---

## M01-S8 — XMPP SCRAM: TLS, SHA256 dan fallback terkontrol

**Linear:**
[ARD-205](https://linear.app/ardani/issue/ARD-205/m01-s8-xmpp-scram-tls-sha256-dan-fallback-terkontrol).
**Status:** Planned/Backlog. **Prasyarat:** ARD-204 merged. **Branch:**
`fix/m01-s8`. **Alert:**
[#13](https://github.com/ardani17/genieacs-pwa/security/code-scanning/13),
[#14](https://github.com/ardani17/genieacs-pwa/security/code-scanning/14).

**Read set:**

- `lib/xmpp-client.ts`
- `docs/operations/legacy-protocol-crypto.md`

**Write set (buat jika belum ada):**

- `lib/xmpp-client.ts`
- `lib/xmpp-scram.ts`
- `lib/config.ts`
- `test/security/xmpp-scram.ts`
- `test/security/xmpp-negotiation.ts`
- `docs/operations/legacy-protocol-crypto.md`
- `scripts/check-suites.json`

**Interfaces:**
selectSasl(mechanisms:Set<string>,tlsVerified:boolean,allowLegacySha1:boolean,allowPlain?:boolean):'SCRAM-SHA-256'|'SCRAM-SHA-1'|'PLAIN';
scramProof(hash:'sha256'|'sha1',input):{proof,serverSignature}.

### Langkah

- [ ] Periksa prasyarat/read set dan buat branch `fix/m01-s8` dari development
      terbaru. Baseline kegagalan di luar paket dihentikan/dicatat.
- [ ] Tambahkan assertion pertama berikut pada file test write set yang sesuai.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { selectSasl } from "../../lib/xmpp-scram.ts";
test("TLS and SHA256 take precedence over PLAIN or legacy", () => {
  const methods = new Set(["PLAIN", "SCRAM-SHA-1", "SCRAM-SHA-256"]);
  assert.equal(selectSasl(methods, true, false), "SCRAM-SHA-256");
  assert.throws(() => selectSasl(methods, false, true), /TLS/);
});
```

- [ ] Jalankan suite sandbox ID `M01-S8`; expected red pada perilaku/modul yang
      sedang diperbaiki, lalu lakukan perubahan satu per satu:

- [ ] Wajib TLS terverifikasi sebelum credential; lakukan STARTTLS jika
      ditawarkan, gagal bila tidaktersedia/taktrusted. Prioritas SCRAM-SHA-256
      lalu legacySCRAM-SHA-1 hanyaallowLegacyexplicit, PLAIN
      hanyaverifiedTLS+policyexistingyangdidokumentasikan. Jangan menawarkan
      mekanisme -PLUS tanpa channelbindingimplementasi.
- [ ] Tambahkan config typed `XMPP_ALLOW_LEGACY_SHA1:boolean=false` dan
      `XMPP_ALLOW_PLAIN:boolean=false` ke lib/config.ts; baca melalui
      konfigurasi deployment server, bukan input browser. Aktifkan fallback
      hanya setelah admin meninjau migrasi/risiko; TLS tetap wajib. Masukkan
      keputusan default dan perbedaan dari source baseline pada migration note.
- [ ] Parameterize SCRAM hash/HMAC/PBKDF sesuai nama mekanisme. Bandingkan
      signature server constant-time dengan lengthcheck; nonce server
      harusprefixnonceclient dan lebihpanjang. Batasi
      iteration1..1000000/salt≤1024byte/message≤8192byte agar server tidak
      memaksa CPU takterbatas.
- [ ] Test RFC5802 SHA1 dan RFC7677 SHA256 known-answer vectors,
      tamperedproof/signature/nonce/iteration/salt, fakeTLS
      untrusted/missingSTARTTLS, no fallback setelah stronger mechanism gagal.
- [ ] Catat legacy compatibility profile dan langkah migrasi serverXMPP; tidak
      mengubah parameter CPE otomatis. WeakcryptosinkSHA1
      bolehtersisadalamjalurlegacyyangterbatas dan menjadi review S9, bukan
      klaim semuaalertfixed.
- [ ] Log hanya chosenmechanism/TLSverified/outcome, tanpa
      username/password/challenge/proof/signature. Permission dan dashboard auth
      tidak berubah.

- [ ] Jalankan acceptance lengkap, code path positif/negatif dan pemeriksaan
      log.

**Acceptance:** Alert#13/#14 termapping exact duaHMACsink;
SHA256dipilihketikatersedia, PLAINtidakmenangatasSCRAM, verifiedTLSmandatory,
crypto vectors/tamper/bounds lulus. Legacyonlyserver membutuhkan
konfigurasi/review eksplisit dan labinterop.

```sh
docker compose -p genieacs-pwa-security-check -f compose.security-test.yaml run --rm security-verify node /source/scripts/security/check-alerts.mjs M01-S8
git diff --check
```

Expected PASS, tidak ada efek samping/secret/timeout yang tak diharapkan.
Daftarkan suite pada scripts/check-suites.json dan runner security; artefak
wajib tidak boleh kosong. Hasil scanner harus menyebut commit dan ref.

- [ ] Review diff, commit hanya write set, push branch dan PR development: judul
      `[ARD-205] M01-S8 — XMPP SCRAM: TLS, SHA256 dan fallback terkontrol`,
      body-file memuat alert URL, hasil tes, log redaction, compatibility, scan
      dan risiko tersisa. Commit
      `fix(security): xmpp scram: tls, sha256 dan fallback terkontrol`. Tiket In
      Review setelah PR; Done setelah acceptance+merge. State alert GitHub belum
      dianggap fixed tanpa scan ref yang benar.

**Stop / pemulihan:** Jika existingXMPPtanpaTLS putus, tandai
breakingsecuritychange dengan migrationrunbook;
tidakdisablecertcheck/downgradeotomatis. Human memilihlegacyexception,
bukanagen. Rollback hanya perubahan branch paket; tidak reset branch protected,
tidak mengubah rute/volume/kernel/reference.

---

## M01-S9 — Gate alert GitHub dan bukti penutupan pada branch yang benar

**Linear:**
[ARD-206](https://linear.app/ardani/issue/ARD-206/m01-s9-gate-alert-github-dan-bukti-penutupan-pada-branch-yang-benar).
**Status:** Planned/Backlog. **Prasyarat:** ARD-205 merged. **Branch:**
`fix/m01-s9`. **Alert:** Seluruh16CodeQL+Dependabot#1, setelah S1–S8 dan M01-B.

**Read set:**

- `docs/design/github-security-alerts.json`
- `docs/design/github-security-alerts.md`
- `.github/workflows/ci.yml`

**Write set (buat jika belum ada):**

- `scripts/security/github-alert-gate.mjs`
- `scripts/security/github-alert-gate.test.mjs`
- `.github/workflows/security-alerts.yml`
- `docs/testing/github-security-evidence.json`
- `docs/design/github-security-alerts.json`
- `scripts/check-suites.json`

**Interfaces:**
evaluateGithubAlerts({alerts,analyses,expectedRef,expectedSha,exceptions}):GateReport;
states planned|needs_validation|fixed_verified|risk_accepted|blocked.
API401/403/missinganalysis/staleSHA tidak dianggap nol.

### Langkah

- [ ] Periksa prasyarat/read set dan buat branch `fix/m01-s9` dari development
      terbaru. Baseline kegagalan di luar paket dihentikan/dicatat.
- [ ] Tambahkan assertion pertama berikut pada file test write set yang sesuai.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGithubAlerts } from "./github-alert-gate.mjs";
test("successful analysis job with open alert is not a clean gate", () => {
  const r = evaluateGithubAlerts({
    alerts: [
      {
        number: 9,
        state: "open",
        rule: { security_severity_level: "critical" },
      },
    ],
    analyses: [{ commit_sha: "old" }],
    expectedRef: "refs/heads/development",
    expectedSha: "new",
    exceptions: [],
  });
  assert.equal(r.passed, false);
});
```

- [ ] Jalankan suite sandbox ID `M01-S9`; expected red pada perilaku/modul yang
      sedang diperbaiki, lalu lakukan perubahan satu per satu:

- [ ] Snapshot ulang dua API dengan pagination dan simpan summary terkurasi;
      hitung alert unique number+tool/rule dan instance ref/category terpisah.
      Simpan checkedAtUTC, branch/commit/sourceurl dan patchPR/testIDs; raw
      SARIF tak diperlukan di repo.
- [ ] Semua#1..16 dan Dependabot#1 harus punya paket/PR/evidence. Dependency
      esbuild memakai M01-B/ARD165: minfixed0.28.1,target0.28.2; audit
      resolvedlock dan npm ls, jangan duplikasi upgrade di banyakPR.
- [ ] Gate melihat hasil analisis pada exact expectedSha/ref setelah patchmerge
      kedevelopment. Defaultbranchmain masihopen sebelumrelease bukan alasan
      mendismiss; verifikasi ulang main sesudahrelease. StatusCI SUCCESS saja
      takmenutupalert.
- [ ] Semua unreviewedcritical/high memblokrelease. MediumXSS dan lowesbuild
      snapshot ini juga wajibdiselesaikan; residualprotocolcrypto hanya lewat
      exceptionreviewmanusia beralasan dengan
      scope/CWE/kompensasi/pemilik/expiry≤30hari, tetap
      tampakrisk_acceptedbukanfixed. Kategori falsepositive hanya bila
      buktiflowmemenuhipenilaian reviewer.
- [ ] Workflow pin actionSHAs, CodeQL JS/TS+Actions dan gate terpisah,
      tidakmenghilangkanquery/file/category. security-eventsread hanya
      jobauthfirstparty; tokenbukanbrowser/log dan forkPRtidakmenerimatoken.
      APIratelimit/permissionerror→blocked, bukanemptylist.
- [ ] Negativefixtures: opentargetalert, API403, staleSHA, incompletepagination,
      expiredexception, newcriticalalert, categorymissing. Uji gate dengan
      fixtureJSON tanpa network; authenticated fetchproduction hanya
      metadataread, bukan exploit.
- [ ] Setelahgatelulus evidenceperalert planned→fixed_verifiedberisi
      commit/test/scanref. AgenttidakmenekanDismiss/AutoFix,
      tidakmengubahbranchprotectionatautriggerdeployment dalamtaskini.

- [ ] Jalankan acceptance lengkap, code path positif/negatif dan pemeriksaan
      log.

**Acceptance:** Mapping lengkap17alert; oldmainvsdevelopmentinstances ditangani;
release gate gagaluntukopenunreviewed/stalereport;
approvedexceptiontransparan/berexpiry.
Dependabotfixeddiverifikasigraph+GitHubmainpostrelease.
Auditmetadata1Novembertidakdiklaimzero-vulnerability.

```sh
docker compose -p genieacs-pwa-security-check -f compose.security-test.yaml run --rm security-verify node /source/scripts/security/check-alerts.mjs M01-S9
git diff --check
```

Expected PASS, tidak ada efek samping/secret/timeout yang tak diharapkan.
Daftarkan suite pada scripts/check-suites.json dan runner security; artefak
wajib tidak boleh kosong. Hasil scanner harus menyebut commit dan ref.

- [ ] Review diff, commit hanya write set, push branch dan PR development: judul
      `[ARD-206] M01-S9 — Gate alert GitHub dan bukti penutupan pada branch yang benar`,
      body-file memuat alert URL, hasil tes, log redaction, compatibility, scan
      dan risiko tersisa. Commit
      `fix(security): gate alert github dan bukti penutupan pada branch yang benar`.
      Tiket In Review setelah PR; Done setelah acceptance+merge. State alert
      GitHub belum dianggap fixed tanpa scan ref yang benar.

**Stop / pemulihan:** Permission security-eventsread kurang, serviceAPIgagal
atau scanbelumexactSHA: catatblocked dan tungguanalisis, jangan
returnpass/menurunkanchecks. Userrequestsekaranghanyaplanning:
tidakmenutupalert. Rollback hanya perubahan branch paket; tidak reset branch
protected, tidak mengubah rute/volume/kernel/reference.

---
