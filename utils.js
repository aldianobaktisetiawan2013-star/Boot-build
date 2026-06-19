// utils.js
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

/**
 * Cek apakah file zip valid & punya pubspec.yaml di root project.
 * Mengembalikan { valid: boolean, reason?: string, rootDir?: string }
 */
function validateFlutterZip(zipPath) {
  let zip;
  try {
    zip = new AdmZip(zipPath);
  } catch (e) {
    return { valid: false, reason: "File bukan ZIP yang valid atau corrupt." };
  }

  const entries = zip.getEntries().map((e) => e.entryName);
  if (entries.length === 0) {
    return { valid: false, reason: "ZIP kosong." };
  }

  // pubspec.yaml bisa ada di root, atau di dalam satu folder pembungkus (project/pubspec.yaml)
  const pubspecEntry = entries.find((e) => e.toLowerCase().endsWith("pubspec.yaml"));
  if (!pubspecEntry) {
    return { valid: false, reason: "Tidak ditemukan pubspec.yaml. Pastikan ini project Flutter." };
  }

  // root dir = folder yang berisi pubspec.yaml (kosong string jika di root zip)
  const rootDir = pubspecEntry.includes("/")
    ? pubspecEntry.substring(0, pubspecEntry.lastIndexOf("/") + 1)
    : "";

  return { valid: true, rootDir };
}

/**
 * Extract zip ke folder tujuan, lalu kembalikan path folder project
 * (folder yang berisi pubspec.yaml langsung).
 */
function extractFlutterProject(zipPath, destDir, rootDir) {
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(destDir, true);
  return rootDir ? path.join(destDir, rootDir) : destDir;
}

/**
 * Zip ulang folder project (untuk diupload ke GitHub) menjadi satu file source.zip
 */
function zipFolder(folderPath, outputZipPath) {
  const zip = new AdmZip();
  zip.addLocalFolder(folderPath);
  zip.writeZip(outputZipPath);
  return outputZipPath;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function cleanupPath(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function humanSize(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(2)} ${units[i]}`;
}

module.exports = { validateFlutterZip, extractFlutterProject, zipFolder, ensureDir, cleanupPath, humanSize };
