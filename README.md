# WEB2APK Bot (versi kamu sendiri)

Bot Telegram yang menerima file ZIP project Flutter, lalu build APK lewat
GitHub Actions, dan kirim balik APK-nya. Semua token/credential pakai
environment variable — **tidak ada yang di-hardcode**, jadi tidak akan
kena `401 Bad credentials` karena token kadaluarsa milik orang lain.

## 1. Siapkan akun & token

1. **Telegram API_ID & API_HASH** -> buka https://my.telegram.org -> API Development Tools.
2. **BOT_TOKEN** -> buat bot baru lewat @BotFather di Telegram.
3. **GitHub Personal Access Token** -> GitHub -> Settings -> Developer settings ->
   Personal access tokens -> buat token dengan scope `repo` dan `workflow`.
4. **Repo GitHub khusus build** -> buat repo baru (bisa private), ini akan jadi
   tempat source di-upload sementara dan workflow dijalankan.

## 2. Pasang workflow di repo target

Copy file `.github_workflow_template/build.yml` ke dalam repo target kamu,
di path:

```
.github/workflows/build.yml
```

Commit & push ke branch yang sama dengan `GITHUB_BRANCH` di `.env` (default `main`).

## 3. Isi environment variable

Copy `.env.example` jadi `.env`, isi semua nilainya (lihat komentar di tiap baris).

## 4. Install & jalankan

```
npm install
npm start
```

Saat pertama kali jalan, console akan mencetak `BOT_SESSION` -- copy nilainya
ke `.env` supaya bot tidak perlu login ulang setiap restart.

## 5. Jalankan via panel (Pterodactyl / panel Node.js sejenis)

- Egg/image: gunakan egg **Node.js** (versi 18+ atau 20).
- Startup command:
  ```
  npm install && npm start
  ```
- Masukkan semua isi `.env` ke bagian Startup Variables / Environment Variables
  di panel (bukan ke file `.env` langsung, kecuali panel kamu support upload file).
- Pastikan resource panel (RAM/disk) cukup untuk file ZIP s/d 2GB + proses
  ekstrak sementara di folder `tmp/`.

## Cara kerja singkat

1. User kirim ZIP Flutter ke bot -> divalidasi harus ada pubspec.yaml.
2. File masuk antrian (queue.js), diproses satu-satu.
3. Project di-zip ulang lalu diupload ke builds/<id>/source.zip di repo target.
4. Bot trigger workflow_dispatch pada build.yml.
5. Bot polling status run sampai selesai.
6. Kalau sukses: artifact APK didownload lalu dikirim ke user via Telegram.
7. Kalau gagal: bot kirim ringkasan error + link log GitHub Actions.
8. Source di repo dihapus otomatis setelah build selesai (cleanup).

## Catatan

- File besar (s/d 2GB) bisa diterima/dikirim karena bot pakai GramJS
  (protokol MTProto), bukan Bot API HTTP biasa yang dibatasi sekitar 50MB.
- Kalau mau wajibkan user join channel dulu sebelum build, isi CHANNEL_USERNAME
  di .env dan tambahkan logic pengecekan member di index.js, pakai
  client.invoke(new Api.channels.GetParticipant(...)).
