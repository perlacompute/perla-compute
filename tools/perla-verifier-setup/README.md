# Perla native verifier — VPS setup

Installer untuk Perla VPS 0.2.3 pada `perlacompute.xyz`. Konfigurasi disiapkan untuk VPS yang telah dilaporkan: 8 CPU, RAM 15 GiB dengan sekitar 13 GiB tersedia, dan sekitar 130 GiB disk kosong.

## Jalankan

Upload `perla-verifier-setup.zip` ke `/root`:

```bash
cd /root
unzip perla-verifier-setup.zip
bash /root/perla-verifier-setup/start.sh /var/www/perla-vps
```

Tidak memerlukan private key wallet. Installer membuat token autentikasi verifier sendiri dan tidak menampilkannya di report.

Nginx site default adalah `/etc/nginx/sites-available/perlacompute.xyz`. Jika konfigurasi aktif berada di file lain, berikan file tersebut sebagai argumen kedua:

```bash
bash /root/perla-verifier-setup/start.sh /var/www/perla-vps /etc/nginx/sites-available/NAMA_FILE_AKTIF
```

Installer memeriksa bahwa file tersebut benar-benar dimuat Nginx dan memiliki HTTPS server untuk domain Perla. File yang tidak cocok ditolak sebelum build native.

## Proses

1. Memeriksa source project, domain HTTPS, Nginx, kapasitas, port dan konfigurasi yang sudah ada.
2. Build native Rust/PyO3 dari pinned Pearl commit `82e6eee7076aafe10123e08db78f100d270c0582`. Source verifier sama dengan paket Perla; build Cargo dibatasi dua job. Build pertama dapat memakan waktu dan mengunduh dependency.
3. Menjalankan container `perla-native-verifier` dengan batas 4 CPU, RAM 5 GiB, 128 PID, user non-root, filesystem read-only dan capability yang dilepas. Port dipublikasikan hanya pada `127.0.0.1:8766`.
4. Menambahkan dua route HTTPS yang tepat pada Nginx: `/__perla_verifier/health` dan `/__perla_verifier/verify`. Keduanya tetap memerlukan bearer token. Konfigurasi TLS dan route website dipertahankan.
5. Menguji health lokal, penolakan akses tanpa autentikasi, health HTTPS, sebuah native proof dari fixture CPU, dan penolakan proof ketika challenge diganti.
6. Mengisi `PERLA_VERIFIER_URL` dan `PERLA_VERIFIER_TOKEN`, lalu memuat ulang environment container web dan menguji akses terautentikasi dari dalam container web.
7. Mencetak **Public verifier report**, yang aman dikirim ke chat.

Backup `.env` dan konfigurasi Nginx serta secret verifier disimpan dengan izin terbatas di `/var/www/perla-vps/data/verifier-setup`. Source website, kontrak token, distributor dan database kontribusi tidak diganti. Jika gagal pada tahap pemasangan, installer berusaha memulihkan konfigurasi dan container verifier sebelumnya.

## Batas pengujian

Fixture CPU hanya memeriksa parser dan matematika native. Fixture dibuat langsung di verifier dan **tidak dikirim ke API kontribusi**. Installer tidak menerbitkan job, menambah poin, mendanai reward, atau melakukan transaksi blockchain.

`PERLA_MINING_ENABLED` tetap `false`. GPU inference melalui miner dan proof-to-ledger tetap harus diuji pada host GPU H100/H200 yang didukung. Verifier CPU yang sehat belum membuktikan jalur GPU tersebut.

17 pemeriksaan lokal untuk parser konfigurasi, pengubahan environment, penanganan redirect dan rollback installer telah lolos. Docker/Nginx dan respons verifier pada uji alur lokal disimulasikan; build image native dan pengujian proof sesungguhnya dijalankan di VPS oleh installer ini. Paket ini tidak menyatakan bahwa instalasi VPS sudah selesai sebelum report nyata diterima.

## Jika build gagal

Kirim bagian error terakhir terminal. Jika sudah ada container verifier tetapi gagal startup:

```bash
docker logs --tail 60 perla-native-verifier
```

Jika instalasi gagal dan kandidat sudah dibersihkan, container tersebut mungkin tidak ada. Simpan folder `data/verifier-setup` dan cache Docker untuk diagnosis serta percobaan berikutnya. Jangan aktifkan mining untuk melewati error verifier.

## Lisensi

Lihat `native/NOTICE.md`. Build mengambil source upstream yang dipin dan menyimpan root license dalam runtime image. Perla adalah integrasi terpisah dan tidak menyatakan endorsement oleh Pearl atau Robinhood.
