const fs = require("fs");
const path = require("path");
const { contentHash } = require("./contentHash");

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
  // Skip if an item with the same content hash already sits in the inbox
  // (prevents the extension from queueing the same chat multiple times)
  const hash = item.content ? contentHash(item.content) : null;
  if (hash && inbox.some((existing) => existing.contentHash === hash)) {
    return item;
  }
  const entry = { ...item, contentHash: hash };
  inbox.push(entry);
  writeInbox(inbox);
  return entry;
}

module.exports = { readInbox, writeInbox, pushToInbox };
