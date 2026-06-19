// github.js
// Semua komunikasi ke GitHub REST API. Token & repo diambil dari config (env var),
// TIDAK ada yang di-hardcode di sini.

const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");
const cfg = require("./config");

const API = "https://api.github.com";

function headers(extra = {}) {
  return {
    Authorization: `Bearer ${cfg.GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "WEB2APK-Bot/1.0",
    ...extra,
  };
}

async function ghFetch(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`GitHub API ${res.status} ${res.statusText} - ${url}\n${body}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

/**
 * Upload source.zip project ke repo target, di path builds/<buildId>/source.zip
 * lewat Contents API (PUT, base64).
 */
async function uploadSource(buildId, zipFilePath) {
  const content = fs.readFileSync(zipFilePath).toString("base64");
  const repoPath = `builds/${buildId}/source.zip`;
  const url = `${API}/repos/${cfg.GITHUB_OWNER}/${cfg.GITHUB_REPO}/contents/${repoPath}`;

  const res = await ghFetch(url, {
    method: "PUT",
    body: JSON.stringify({
      message: `build: upload source for ${buildId}`,
      content,
      branch: cfg.GITHUB_BRANCH,
    }),
  });
  return res.json();
}

/**
 * Trigger workflow_dispatch dengan input build_id, kembalikan timestamp dispatch
 * (dipakai untuk mencocokkan run mana yang baru kita pancing).
 */
async function dispatchWorkflow(buildId) {
  const url = `${API}/repos/${cfg.GITHUB_OWNER}/${cfg.GITHUB_REPO}/actions/workflows/${cfg.GITHUB_WORKFLOW_FILE}/dispatches`;
  const dispatchedAt = Date.now();

  await ghFetch(url, {
    method: "POST",
    body: JSON.stringify({
      ref: cfg.GITHUB_BRANCH,
      inputs: { build_id: buildId },
    }),
  });

  return dispatchedAt;
}

/**
 * Cari workflow run yang baru saja kita dispatch (polling beberapa kali karena
 * GitHub butuh waktu beberapa detik untuk membuat run-nya).
 */
async function findRun(dispatchedAt, retries = 10) {
  const url = `${API}/repos/${cfg.GITHUB_OWNER}/${cfg.GITHUB_REPO}/actions/workflows/${cfg.GITHUB_WORKFLOW_FILE}/runs?event=workflow_dispatch&branch=${cfg.GITHUB_BRANCH}&per_page=5`;

  for (let i = 0; i < retries; i++) {
    const res = await ghFetch(url);
    const data = await res.json();
    const run = (data.workflow_runs || []).find(
      (r) => new Date(r.created_at).getTime() >= dispatchedAt - 5000
    );
    if (run) return run;
    await sleep(3000);
  }
  throw new Error("Tidak menemukan workflow run setelah dispatch. Cek nama workflow file di config.");
}

/**
 * Poll status run sampai selesai (completed), atau timeout.
 * onProgress(status) dipanggil setiap kali status berubah.
 */
async function waitForRun(runId, onProgress) {
  const url = `${API}/repos/${cfg.GITHUB_OWNER}/${cfg.GITHUB_REPO}/actions/runs/${runId}`;
  const deadline = Date.now() + cfg.BUILD_TIMEOUT_MS;
  let lastStatus = "";

  while (Date.now() < deadline) {
    const res = await ghFetch(url);
    const run = await res.json();

    if (run.status !== lastStatus) {
      lastStatus = run.status;
      if (onProgress) onProgress(run.status, run);
    }

    if (run.status === "completed") return run;
    await sleep(cfg.POLL_INTERVAL_MS);
  }
  throw new Error("Build timeout. Build di GitHub Actions tidak selesai dalam waktu yang ditentukan.");
}

/**
 * Download artifact hasil build (APK) dari run yang sudah selesai,
 * extract, kembalikan path file .apk pertama yang ditemukan.
 */
async function downloadArtifactApk(runId, buildId, destDir) {
  const listUrl = `${API}/repos/${cfg.GITHUB_OWNER}/${cfg.GITHUB_REPO}/actions/runs/${runId}/artifacts`;
  const listRes = await ghFetch(listUrl);
  const list = await listRes.json();

  const artifact = (list.artifacts || []).find((a) => a.name === `apk-${buildId}`);
  if (!artifact) throw new Error("Artifact APK tidak ditemukan. Build mungkin gagal sebelum upload-artifact.");

  const dlRes = await ghFetch(artifact.archive_download_url);
  const buffer = Buffer.from(await dlRes.arrayBuffer());

  fs.mkdirSync(destDir, { recursive: true });
  const tmpZipPath = path.join(destDir, `artifact-${buildId}.zip`);
  fs.writeFileSync(tmpZipPath, buffer);

  const zip = new AdmZip(tmpZipPath);
  zip.extractAllTo(destDir, true);

  const apkEntry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith(".apk"));
  if (!apkEntry) throw new Error("File .apk tidak ditemukan di dalam artifact.");

  return path.join(destDir, apkEntry.entryName);
}

/**
 * Ambil log singkat job yang gagal (buat ditampilkan ke user kalau error).
 */
async function getFailureSummary(runId) {
  try {
    const url = `${API}/repos/${cfg.GITHUB_OWNER}/${cfg.GITHUB_REPO}/actions/runs/${runId}/jobs`;
    const res = await ghFetch(url);
    const data = await res.json();
    const failedJob = (data.jobs || []).find((j) => j.conclusion === "failure");
    if (!failedJob) return "Tidak ada detail tambahan.";
    const failedStep = (failedJob.steps || []).find((s) => s.conclusion === "failure");
    return failedStep ? `Gagal di step: "${failedStep.name}"` : `Job "${failedJob.name}" gagal.`;
  } catch {
    return "Tidak bisa mengambil detail error dari GitHub.";
  }
}

/**
 * Hapus source.zip yang sudah dibuild dari repo, biar repo gak numpuk.
 */
async function cleanupSource(buildId) {
  try {
    const repoPath = `builds/${buildId}/source.zip`;
    const url = `${API}/repos/${cfg.GITHUB_OWNER}/${cfg.GITHUB_REPO}/contents/${repoPath}?ref=${cfg.GITHUB_BRANCH}`;
    const getRes = await ghFetch(url);
    const fileData = await getRes.json();

    await ghFetch(`${API}/repos/${cfg.GITHUB_OWNER}/${cfg.GITHUB_REPO}/contents/${repoPath}`, {
      method: "DELETE",
      body: JSON.stringify({
        message: `chore: cleanup source for ${buildId}`,
        sha: fileData.sha,
        branch: cfg.GITHUB_BRANCH,
      }),
    });
  } catch (e) {
    console.warn("Gagal cleanup source di repo:", e.message);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  uploadSource,
  dispatchWorkflow,
  findRun,
  waitForRun,
  downloadArtifactApk,
  getFailureSummary,
  cleanupSource,
};
