// config.js
require("dotenv").config();

function required(name) {
  if (!process.env[name]) {
    console.warn(`⚠️  ENV "${name}" belum diisi. Isi dulu di file .env / panel sebelum jalan.`);
  }
  return process.env[name];
}

module.exports = {
  BOT_NAME: process.env.BOT_NAME || "WEB2APK",

  // ─── TELEGRAM (GramJS - support upload/download file besar s/d 2GB) ───────
  API_ID: parseInt(process.env.API_ID || "0"),
  API_HASH: required("API_HASH"),
  BOT_TOKEN: required("BOT_TOKEN"),
  BOT_SESSION: process.env.BOT_SESSION || "", // opsional, biar gak login ulang tiap restart

  ADMIN_IDS: (process.env.ADMIN_IDS || "").split(",").map(Number).filter(Boolean),

  // Wajib join channel ini sebelum bisa build (opsional, isi "" untuk nonaktifkan)
  CHANNEL_USERNAME: process.env.CHANNEL_USERNAME || "",

  // ─── GITHUB (untuk trigger GitHub Actions build APK) ───────────────────────
  GITHUB_TOKEN: required("GITHUB_TOKEN"),       // PAT dengan scope: repo, workflow
  GITHUB_OWNER: required("GITHUB_OWNER"),       // username/organisasi GitHub kamu
  GITHUB_REPO: required("GITHUB_REPO"),         // repo tempat workflow build.yml berada
  GITHUB_BRANCH: process.env.GITHUB_BRANCH || "main",
  GITHUB_WORKFLOW_FILE: process.env.GITHUB_WORKFLOW_FILE || "build.yml",

  // ─── SYSTEM ─────────────────────────────────────────────────────────────────
  TMP_DIR: "./tmp",
  MAX_FILE_SIZE: 2 * 1024 * 1024 * 1024, // 2 GB
  BUILD_TIMEOUT_MS: 30 * 60 * 1000,      // 30 menit
  POLL_INTERVAL_MS: 7000,                // poll status build tiap 7 detik
  MAINTENANCE: process.env.MAINTENANCE === "true",
};
