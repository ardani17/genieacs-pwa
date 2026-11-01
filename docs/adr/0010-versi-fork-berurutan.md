---
status: accepted
---

# Versi fork mengikuti urutan patch tetap

Pengguna meminta tag rilis selalu berurutan dalam jalur v1.2.N: setelah v1.2.16
adalah v1.2.17, kemudian v1.2.18. Perubahan besar tidak melompat major/minor.
Baseline engine upstream dan versi dependency dicatat terpisah.

Ini memilih kesinambungan penomoran fork daripada makna kompatibilitas SemVer.
Perubahan tidak kompatibel tetap wajib mempunyai penanda Breaking changes,
migration notes dan prosedur rollback. Tag yang sudah dipublikasikan bersifat
tetap; perbaikannya memakai nomor berikutnya. Detail algoritma dan gate ada pada
[kebijakan release](../design/release-policy.md).
