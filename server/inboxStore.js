const fs = require("fs");
const path = require("path");

// Shared by server/index.js (extension imports) and screenpipeIngest.js
// (automatic activity capture) — a single read/write path avoids two writers
// racing on the same file.
const DATA_DIR = path.join(__dirname, "data");
const INBOX_FILE = path.join(DATA_DIR, "inbox.json");

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readInbox() {
  ensureData();
  try {
    return JSON.parse(fs.readFileSync(INBOX_FILE, "utf8") || "[]");
  } catch {
    return [];
  }
}

function writeInbox(arr) {
  ensureData();
  fs.writeFileSync(INBOX_FILE, JSON.stringify(arr, null, 2));
}

function pushToInbox(item) {
  const inbox = readInbox();
  inbox.push(item);
  writeInbox(inbox);
  return item;
}

module.exports = { readInbox, writeInbox, pushToInbox };
