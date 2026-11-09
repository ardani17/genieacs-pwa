# UI ringkas dan nyaman untuk sentuhan

Pengguna menyetujui perbaikan ukuran setelah audit shadcn/ui pada 9 November
2026, lalu meminta tampilan tidak terlalu lebar dan tetap nyaman di mobile.

## Rancangan

Pertahankan shadcn/ui, tema, fungsi, permission dan seluruh API. Gunakan token
ukuran bersama: kontrol 44 px secara default dan pada perangkat sentuh; pada
viewport minimal 768 px dengan pointer presisi, default 36 px, sm 32 px, xs 28
px dan lg 40 px. Input pada perangkat sentuh tetap 16 px. Checkbox visual 20 px
memiliki area sentuh 44 px dan area pointer desktop 32 px.

Card memakai padding/gap 16 px, judul halaman 20–24 px dan jarak bagian 16 px.
Konten dashboard maksimal 1024 px. Sidebar desktop selebar 224 px hanya muncul
mulai 1024 px; viewport yang lebih kecil memakai topbar, bottom navigation dan
Sheet yang sudah ada. Sidebar dapat discroll pada layar pendek. Urutan dan
ukuran halaman pada filter memakai dua kolom juga di mobile; pencarian mengambil
satu baris sampai 1280 px. Input filter lanjutan dan tombol Terapkan berbagi
satu baris selama lebar cukup. Tabel desktop perangkat memakai padding sel lebih
kecil dan link baris 32 px, sehingga tinggi baris sekitar 40 px pada pointer
presisi.

Ukuran responsif mengikuti kemampuan pointer, sehingga tablet atau laptop sentuh
tetap mendapat target 44 px. Tabel panjang tetap memiliki scroll lokal. Jangan
mengubah zoom global atau memperkecil teks input mobile. Hindari pengecilan area
sentuh lewat override di komponen fitur.

## Pilihan dan verifikasi

Pendekatan yang dipilih adalah token ukuran responsif bersama; override per
halaman akan membuat ukuran kembali tidak konsisten. Zoom global juga
memperkecil teks dan target sentuh sehingga tidak digunakan.

Perbarui kontrak UI dan pengujian browser yang sebelumnya menuntut semua kontrol
desktop 44 px. Verifikasi login, daftar/detail perangkat, overview, admin, VPN
dan log pada 360×800, 768×1024 serta 1440×900. Periksa overflow, ukuran kontrol,
menu tablet, keyboard/fokus dan hasil screenshot. Tambahkan pemeriksaan pointer
sentuh di desktop dan batas konten pada layar lebar. Jalankan format, lint,
TypeScript, unit test serta production build.
