# Perla — setup token testnet 1B

Runner untuk source VPS Perla 0.2.3 di `/var/www/perla-vps`. Runner memakai image Docker build dari project yang sudah ada, sehingga host tidak perlu instal Node atau dependency tambahan. Ubuntu memerlukan Docker, Python 3, dan `flock`.

## Jalankan di VPS

Upload `perla-testnet-setup.zip` ke `/root`, lalu:

```bash
cd /root
unzip perla-testnet-setup.zip
bash /root/perla-testnet-setup/start.sh /var/www/perla-vps
```

Masukkan private key **wallet khusus testnet** ketika terminal memintanya. Input tidak ditampilkan. Jangan kirim private key atau seed phrase melalui chat. Wallet perlu test ETH pada Robinhood Testnet, chain ID 46630. Jangan menggunakan wallet treasury/mainnet untuk pengujian ini.

Jika wallet belum memiliki test ETH, runner menampilkan alamat wallet lalu berhenti sebelum mengirim transaksi. Isi wallet pada jaringan testnet dan jalankan perintah yang sama lagi. RPC default mengikuti `.env` project, atau memakai `https://rpc.testnet.chain.robinhood.com` jika belum diisi. RPC harus merespons chain ID 46630; mainnet ditolak.

## Yang dikerjakan

1. Membangun image operator dari Docker build stage project. Dependency CLI `solc` dan `viem` tersedia di stage ini.
2. Membandingkan fingerprint bytecode dengan kontrak 0.2.3 yang dipaketkan untuk setup ini. Source test token harus versi fixed 1B.
3. Deploy `PerlaTestToken`: tepat 1,000,000,000 tPERLA dengan 18 decimals ke wallet deployer.
4. Deploy `PerlaRewards` yang menunjuk token tersebut; wallet deployer menjadi owner distributor.
5. Memeriksa receipt, supply, decimals, symbol, owner dan reward token melalui RPC.
6. Menyimpan progres publik, membuat backup `.env`, memasang dua alamat kontrak, dan membuat operator token acak hanya jika belum ada.
7. Memuat konfigurasi baru dengan membuat ulang service `web` menggunakan image yang sudah ada.

Setup tidak menulis private key ke berkas deployment. Data yang disimpan ada di `data/testnet-deployment` dengan akses terbatas. `public-report.json` hanya memuat alamat, hash transaksi, jaringan, supply dan status setup; berkas ini aman dibagikan untuk melanjutkan konfigurasi.

## Melanjutkan proses yang terputus

Jalankan `start.sh` lagi dengan wallet yang sama. Deployment yang sudah terverifikasi dipakai kembali. Jika hash transaksi sudah disimpan tetapi receipt belum diterima, runner menunggu transaksi yang sama.

Jika koneksi terputus pada saat broadcast dan RPC tidak pernah mengembalikan hash, runner memblokir deploy ulang otomatis. Periksa riwayat wallet/explorer sebelum mencoba mengganti catatan tersebut. Jangan menghapus folder progres untuk mengatasi transaksi pending. Transaksi reverted juga memerlukan pemeriksaan terlebih dahulu.

Konfigurasi yang sudah menunjuk token/distributor lain ditolak sebelum deploy baru. Mining admission yang sudah aktif juga perlu dipause sebelum perubahan konfigurasi. Runner tidak menimpa konfigurasi konflik atau mereset database.

## Setelah selesai

Kirim isi `public-report.json` atau output publik di akhir terminal. Token berada di wallet deployer. Distributor **belum didanai**: budget dimasukkan per epoch ketika kontribusi valid sudah tersedia. Setup ini tidak menyalakan mining, mengaktifkan jadwal emisi, menerbitkan poin, atau membuat klaim palsu.

Tahap berikutnya adalah memasang native verifier dan menguji GPU yang didukung, baru menyiapkan epoch dari kontribusi asli, mendanainya dengan tPERLA dan menguji claim. Kontrak testnet ini terpisah dari rencana token mainnet Pons.

## Scope verifikasi

12 pemeriksaan deployment dan 5 pemeriksaan konfigurasi lolos. Kode setup diuji dengan EVM lokal untuk dua deployment, supply, konfigurasi distributor, pengulangan, pemulihan timeout, penolakan jaringan lain, konflik source/configuration, wallet berbeda dan saldo gas kosong. Pengubahan `.env` diuji untuk backup, idempotence dan perlindungan nilai lain. Docker daemon dan deployment publik belum dijalankan dari lingkungan pengembangan ini.

Rujukan jaringan resmi: https://docs.robinhood.com/chain/add-network-to-wallet/
