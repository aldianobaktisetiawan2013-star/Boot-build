// index.js
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const path = require("path");
const crypto = require("crypto");

const cfg = require("./config");
const queue = require("./queue");
const gh = require("./github");
const { validateFlutterZip, extractFlutterProject, zipFolder, ensureDir, cleanupPath, humanSize } = require("./utils");

ensureDir(cfg.TMP_DIR);

const session = new StringSession(cfg.BOT_SESSION || "");
const client = new TelegramClient(session, cfg.API_ID, cfg.API_HASH, { connectionRetries: 5 });

// state per user: nunggu kirim zip atau idle
const userState = new Map();

async function main() {
  await client.start({ botAuthToken: cfg.BOT_TOKEN });
  console.log(`✅ ${cfg.BOT_NAME} jalan.`);

  if (!cfg.BOT_SESSION) {
    console.log("ℹ️  Simpan BOT_SESSION ini di .env biar gak perlu login ulang tiap restart:");
    console.log(client.session.save());
  }

  queue.setHandler(processBuildJob);
  client.addEventHandler(onMessage, new NewMessage({}));
}

async function onMessage(event) {
  const message = event.message;
  if (!message || message.out) return; // ignore pesan dari bot sendiri

  const chatId = message.chatId;
  const senderId = message.senderId ? message.senderId.toString() : null;

  try {
    if (cfg.MAINTENANCE && !cfg.ADMIN_IDS.includes(Number(senderId))) {
      return client.sendMessage(chatId, { message: "🛠 Bot sedang maintenance. Coba lagi nanti." });
    }

    const text = message.message || "";

    if (text === "/start") {
      return sendWelcome(chatId);
    }

    if (text === "/status") {
      return client.sendMessage(chatId, {
        message: `📊 Antrian build saat ini: ${queue.size()} job.`,
      });
    }

    if (text === "/cancel") {
      userState.delete(chatId.toString());
      return client.sendMessage(chatId, { message: "❌ Dibatalkan." });
    }

    // cek dokumen (zip)
    if (message.document) {
      return handleDocument(message, chatId, senderId);
    }
  } catch (err) {
    console.error("onMessage error:", err);
    client.sendMessage(chatId, { message: `❌ Terjadi error: ${err.message}` }).catch(() => {});
  }
}

async function sendWelcome(chatId) {
  await client.sendMessage(chatId, {
    message:
      `👋 Halo! Saya **${cfg.BOT_NAME}**.\n\n` +
      `Kirim file **ZIP** project Flutter kamu sekarang.\n\n` +
      `**Persyaratan:**\n` +
      `✅ Format file: .zip\n` +
      `✅ Wajib ada: pubspec.yaml\n` +
      `✅ Maks ukuran: ${humanSize(cfg.MAX_FILE_SIZE)}\n\n` +
      `Kirim file ZIP-nya langsung ke chat ini!`,
  });
}

async function handleDocument(message, chatId, senderId) {
  const doc = message.document;
  const fileName = (doc.attributes || []).find((a) => a.fileName)?.fileName || "file.zip";

  if (!fileName.toLowerCase().endsWith(".zip")) {
    return client.sendMessage(chatId, { message: "❌ File harus berformat .zip" });
  }
  if (Number(doc.size) > cfg.MAX_FILE_SIZE) {
    return client.sendMessage(chatId, {
      message: `❌ Ukuran file melebihi batas maksimal ${humanSize(cfg.MAX_FILE_SIZE)}.`,
    });
  }

  const buildId = crypto.randomBytes(4).toString("hex");
  const workDir = path.join(cfg.TMP_DIR, buildId);
  ensureDir(workDir);
  const zipPath = path.join(workDir, "upload.zip");

  const statusMsg = await client.sendMessage(chatId, { message: "⬇️ Mengunduh file..." });

  await client.downloadMedia(message, {
    outputFile: zipPath,
    progressCallback: throttle((downloaded, total) => {
      const pct = total ? Math.floor((downloaded / total) * 100) : 0;
      editSafe(statusMsg, `⬇️ Mengunduh file... ${pct}%`);
    }, 4000),
  });

  const check = validateFlutterZip(zipPath);
  if (!check.valid) {
    cleanupPath(workDir);
    return editSafe(statusMsg, `❌ Gagal memproses file!\n\n🔴 ${check.reason}\n\nSilakan coba lagi dengan file yang benar.`);
  }

  const position = queue.add({
    buildId,
    workDir,
    zipPath,
    rootDir: check.rootDir,
    chatId,
    senderId,
    statusMsg,
    fileName,
  });

  await editSafe(
    statusMsg,
    `✅ File diterima dan masuk antrian (posisi ${position}).\n` +
      `🆔 Build ID: \`${buildId}\`\n\nKamu akan diberi tahu setiap ada progress.`
  );
}

async function processBuildJob(job) {
  const { buildId, workDir, zipPath, rootDir, chatId, statusMsg } = job;

  try {
    await editSafe(statusMsg, "📦 Menyiapkan project...");
    const projectDir = extractFlutterProject(zipPath, path.join(workDir, "extracted"), rootDir);
    const sourceZipPath = path.join(workDir, "source.zip");
    zipFolder(projectDir, sourceZipPath);

    await editSafe(statusMsg, "☁️ Mengupload source ke GitHub...");
    await gh.uploadSource(buildId, sourceZipPath);

    await editSafe(statusMsg, "🚀 Memicu proses build di GitHub Actions...");
    const dispatchedAt = await gh.dispatchWorkflow(buildId);

    await editSafe(statusMsg, "🔎 Mencari workflow run...");
    const run = await gh.findRun(dispatchedAt);

    await gh.waitForRun(run.id, (status) => {
      const label = { queued: "⏳ Menunggu runner...", in_progress: "⚙️ Sedang building APK..." }[status] || status;
      editSafe(statusMsg, `${label}\n\n🔗 ${run.html_url}`);
    });

    // cek hasil akhir run
    const finalRunRes = await fetch(
      `https://api.github.com/repos/${cfg.GITHUB_OWNER}/${cfg.GITHUB_REPO}/actions/runs/${run.id}`,
      { headers: { Authorization: `Bearer ${cfg.GITHUB_TOKEN}` } }
    );
    const finalRun = await finalRunRes.json();

    if (finalRun.conclusion !== "success") {
      const reason = await gh.getFailureSummary(run.id);
      await editSafe(
        statusMsg,
        `❌ Build gagal!\n\n🔴 ${reason}\n\n🔗 Lihat log lengkap: ${run.html_url}`
      );
      return;
    }

    await editSafe(statusMsg, "⬇️ Mengambil hasil APK...");
    const apkPath = await gh.downloadArtifactApk(run.id, buildId, path.join(workDir, "artifact"));

    await editSafe(statusMsg, "⬆️ Mengirim APK ke kamu...");
    await client.sendFile(chatId, {
      file: apkPath,
      caption: `✅ Build berhasil!\n🆔 ${buildId}`,
      progressCallback: throttle((uploaded, total) => {
        const pct = total ? Math.floor((uploaded / total) * 100) : 0;
        editSafe(statusMsg, `⬆️ Mengirim APK... ${pct}%`);
      }, 4000),
    });

    await editSafe(statusMsg, "✅ Selesai! APK sudah dikirim di atas.");
    await gh.cleanupSource(buildId);
  } catch (err) {
    console.error(`Build ${buildId} error:`, err);
    await editSafe(statusMsg, `❌ Gagal memproses file!\n\n🔴 Error: ${err.message}\n\nSilakan coba lagi.`);
  } finally {
    cleanupPath(workDir);
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function editSafe(message, newText) {
  try {
    await client.editMessage(message.chatId, { message: message.id, text: newText });
  } catch {
    // edit bisa gagal kalau isinya sama / rate limit, aman diabaikan
  }
}

function throttle(fn, ms) {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  };
}

main().catch((err) => {
  console.error("Fatal error saat start bot:", err);
  process.exit(1);
});
