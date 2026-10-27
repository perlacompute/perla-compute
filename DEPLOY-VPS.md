# Deploy Perla Compute ke VPS

Paket ini menjalankan website, akun wallet, worker, job dan ledger kontribusi di
VPS sendiri. Runtime web: Next.js + Node.js 24. Database: SQLite di volume persisten.
Source dasar: `62053af00ad06d90b836ca7dca61b2aa04d816d3`.
Ini ekspor VPS terpisah dari deployment Sites; tidak memerlukan akun Cloudflare.

## 1. Persiapan

- Ubuntu 24.04 x86-64 direkomendasikan; Docker Engine + plugin Docker Compose.
- Nginx dan domain untuk HTTPS. Website bisa dicek lewat localhost sebelum domain.
- Sisakan RAM untuk proses build Next.js. Website tidak memerlukan GPU.
- GPU worker membutuhkan host terpisah: preview RTX 30/40/50 atau jalur inference H100/H200 sesuai panduan `/docs`.
- Native verifier adalah layanan CPU tersendiri, bukan bagian dari proses Next.js.

## 2. Upload dan jalankan website

Upload ZIP ke `/var/www`, lalu:

```bash
cd /var/www
unzip perla-vps-0.2.1.zip
cd perla-vps
bash deploy-vps.sh
docker compose logs --tail 80 web
curl --fail http://127.0.0.1:3109/api/mining/status
```

Script membuat `.env` dari contoh bila belum ada, menjalankan build, lalu
menyalakan website. Migrasi database berjalan otomatis dan tidak menghapus data.
Output status harus menunjukkan `storage: true` dan `miningEnabled: false`.
Port default `3109` hanya bind ke localhost. Ubah `PERLA_HTTP_PORT` bila bentrok,
kemudian sesuaikan `proxy_pass` Nginx.

## 3. Hubungkan domain

Salin `deploy/nginx-perla.conf` ke `/etc/nginx/sites-available/perla`.
Ganti `perla.example.com` dengan domain sebenarnya dan pastikan DNS A menuju VPS.
Set `PERLA_PUBLIC_ORIGIN=https://DOMAIN_LU` di `.env`, lalu jalankan
`docker compose up -d --force-recreate web`. Origin ini memastikan challenge
wallet, cookie Secure dan konfigurasi worker memakai domain HTTPS yang benar.

```bash
sudo ln -s /etc/nginx/sites-available/perla /etc/nginx/sites-enabled/perla
sudo nginx -t
sudo systemctl reload nginx
# Bila Certbot dan plugin Nginx sudah terpasang:
sudo certbot --nginx -d DOMAIN_LU
```

Jangan membuat symlink kedua bila konfigurasi sudah aktif. Gunakan HTTPS untuk
wallet dan worker. Jangan gunakan `DOMAIN_LU` secara literal. Tidak ada domain,
sertifikat, wallet, atau key pribadi yang dimasukkan ke paket ini.

## 4. Konfigurasi runtime

Edit `.env` di VPS. Jangan kirim isinya ke chat atau masukkan ke frontend.

| Variabel | Fungsi |
| --- | --- |
| `PERLA_PUBLIC_ORIGIN` | Origin website HTTPS sebenarnya, tanpa path, misalnya `https://perla.example.com`. |
| `PERLA_MINING_ENABLED` | Default `false`. Buka setelah verifier dan alur GPU lolos uji. |
| `PERLA_VERIFIER_URL` | Origin HTTPS verifier, misalnya `https://verify.DOMAIN_LU`. |
| `PERLA_VERIFIER_TOKEN` | Secret verifier minimal 32 karakter; sama dengan layanan verifier. |
| `PERLA_OPERATOR_TOKEN` | Secret berbeda untuk pengelolaan epoch. |
| `PERLA_REWARD_TOKEN` | Alamat test token yang benar-benar dideploy. |
| `PERLA_DISTRIBUTOR_ADDRESS` | Alamat kontrak PerlaRewards di testnet. |
| `PERLA_RPC_URL` | RPC HTTPS Robinhood Testnet, chain ID 46630. |

Untuk menerapkan perubahan environment pada container:

```bash
docker compose up -d --force-recreate web
```

`docker compose restart` saja tidak memuat perubahan `env_file`.
Nilai `PORT`, `HOSTNAME`, dan `PERLA_SQLITE_PATH` di dalam container ditetapkan
Compose; ubah port host memakai `PERLA_HTTP_PORT`.

## 5. Native verifier dan GPU worker

Baca `/docs#operator` dan `/docs#installation` di website. Source lengkap ada di
`services/pearl-adapter`. Untuk verifier, build dari folder tersebut:

```bash
cd services/pearl-adapter
python3 -c 'import secrets; print("PERLA_VERIFIER_TOKEN=" + secrets.token_hex(32))' > verifier.env
chmod 600 verifier.env
docker build -f Dockerfile.verifier -t perla-verifier:0.1 .
docker run -d --name perla-verifier --restart unless-stopped \
  --memory 5g --cpus 4 --env-file verifier.env \
  -p 127.0.0.1:8766:8766 perla-verifier:0.1
```

Pasang HTTPS reverse proxy terpisah ke port 8766. Secret di `verifier.env` harus
sama dengan `PERLA_VERIFIER_TOKEN` pada environment website. Jangan kirim private
key wallet ke verifier atau miner. Worker cukup memakai token dari dashboard.

Native GPU/kernel dan Docker image masih memerlukan validasi di host tujuan.
Paket ini tidak otomatis menyewa GPU, menghasilkan trafik AI pelanggan, atau
menyalakan distribusi token. Profil awal: dense GEMM rank 128, sertifikat v3,
Jalur inference menargetkan NVIDIA sm90 H100/H200; preview RTX menargetkan
sm86/sm89/sm120. Validasi GPU nyata dan receipt ledger diperlukan pada setiap
jalur sebelum admission publik dibuka.

## 6. Reward testnet

Kontrak dan operator CLI disertakan. Gunakan Node.js 24 di mesin operator:

```bash
npm ci
node scripts/perla-rewards.mjs compile
```

Ikuti `/docs#rewards` dan `/docs#operator` untuk deploy test token/distributor,
menyiapkan epoch, mendanai root, dan aktivasi. CLI menolak chain selain 46630.
Key deploy hanya dari environment lokal operator; tidak dari website.
Kontribusi tidak berubah otomatis menjadi token mainnet atau token Pons.

## 7. Operasi dan backup

```bash
docker compose ps
docker compose logs --tail 100 -f web
docker compose restart web
docker compose stop web
docker compose start web
# Backup konsisten, termasuk data WAL:
docker compose exec web node scripts/backup-vps.mjs /app/data/perla-backup.sqlite
docker compose cp web:/app/data/perla-backup.sqlite ./perla-backup.sqlite
```

Nama backup harus baru; SQLite tidak menimpa file backup yang sudah ada.
Simpan backup di tempat terpisah dengan akses terbatas karena berisi akun dan
hash token. `docker compose down` mempertahankan volume. Jangan menambahkan
`-v` bila masih membutuhkan data. Restore dilakukan saat container berhenti:
gunakan backup konsisten sebagai `perla.sqlite`, hapus WAL/SHM lama yang berkaitan,
dan pertahankan owner file UID 1000. Cadangkan volume sebelum restore.

Untuk update source, backup lebih dulu, pertahankan `.env` dan volume, lalu:

```bash
docker compose up -d --build web
```

Database ekspor ini baru dan kosong. Data dari deployment Cloudflare sebelumnya
tidak disertakan. Tidak ada secret atau sesi pengguna di ZIP.

## 8. Menjalankan tanpa Docker

Gunakan Node.js 24 dan satu proses web (jangan PM2 cluster).

```bash
cp .env.example .env
chmod 600 .env
npm ci
npm run build
npm start
```

Build menyalin aset ke output standalone. `npm start` menjalankan migrasi dan
web server. Gunakan absolute path untuk `PERLA_SQLITE_PATH` bila dijalankan oleh
PM2/systemd, lalu gunakan cwd project yang benar. Nginx tetap diperlukan untuk
domain/HTTPS. Contoh PM2 opsional: `pm2 start npm --name perla-web -- start`.

## 9. Pemeriksaan

```bash
npm run check:vps
npm run check:api
npm run check:rewards
```

Uji mining native membutuhkan Python environment dengan `pearl_mining` dari
commit upstream yang dipin. Set `PERLA_NATIVE_PYTHON` dan `PERLA_PEARL_SOURCE`,
lalu jalankan `npm run check:mining`. Ini menguji matematika proof dan ledger
dengan fixture CPU, bukan bukti performa CUDA.

## RTX 30 / 40 / 50 validation preview

The VPS serves `perla-rtx-worker.tar.gz` and its checksum from `/downloads`. Run that package on a separate Linux GPU host; do not run its CUDA build or miner on this CPU-only VPS. `/platform/setup` provides the RTX path and a separate Hopper inference option. The web updater preserves `.env`, the database volume, verifier and admission settings. Physical GPU validation, a supervised accepted-share trial and reward validation are still required. See `services/rtx-worker/README.md`.
