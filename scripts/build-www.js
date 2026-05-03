// Copies static web assets to www/ for Capacitor native builds.
// Run: npm run build:app
// www/ is used as webDir in capacitor.config.json (offline fallback when server.url is set).

const { cpSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const ROOT = join(__dirname, "..");
const WWW  = join(ROOT, "www");

const FILES = [
  "app.html",
  "app-core.html",
  "app-pro.html",
  "app-black.html",
  "app-client.js",
  "app-mobile.css",
  "scheduler-client.js",
  "followup-client.js",
  "prompts-client.js",
  "todos-client.js",
  "settings-client.js",
  "prompts-data.json",
  "manifest.json",
  "sw.js",
  "access.html",
  "denied.html",
  "book.html",
];

const DIRS = ["icons", "assets"];

mkdirSync(WWW, { recursive: true });

for (const file of FILES) {
  try {
    cpSync(join(ROOT, file), join(WWW, file));
    console.log(`  copied: ${file}`);
  } catch (err) {
    console.warn(`  skipped: ${file} (${err.message})`);
  }
}

for (const dir of DIRS) {
  try {
    cpSync(join(ROOT, dir), join(WWW, dir), { recursive: true });
    console.log(`  copied: ${dir}/`);
  } catch (err) {
    console.warn(`  skipped: ${dir}/ (${err.message})`);
  }
}

console.log("\nwww/ build complete.");
