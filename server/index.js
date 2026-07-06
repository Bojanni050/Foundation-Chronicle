const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HOST = "127.0.0.1"; // localhost-only — never 0.0.0.0
const PORT = process.env.CHRONICLE_PORT || 4577;

const DATA_DIR = path.join(__dirname, "data");
const INBOX_FILE = path.join(DATA_DIR, "inbox.json");
const TOKEN_FILE = path.join(DATA_DIR, "token.txt");

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(INBOX_FILE)) fs.writeFileSync(INBOX_FILE, "[]");
}

function getToken() {
  ensureData();
  if (!fs.existsSync(TOKEN_FILE)) {
    const token = crypto.randomBytes(24).toString("hex");
    fs.writeFileSync(TOKEN_FILE, token);
    return token;
  }
  return fs.readFileSync(TOKEN_FILE, "utf8").trim();
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
  fs.writeFileSync(INBOX_FILE, JSON.stringify(arr, null, 2));
}

const TOKEN = getToken();

const app = express();
app.use(cors()); // safe: server only listens on 127.0.0.1
app.use(express.json({ limit: "10mb" }));

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (token !== TOKEN) return res.status(401).json({ error: "unauthorized" });
  next();
}

// Extension → queue a chat object
app.post("/api/objects/import", requireAuth, (req, res) => {
  const { title, content, sourceProvider, url, tags } = req.body || {};
  if (!content) return res.status(400).json({ error: "content required" });
  const inbox = readInbox();
  const objectId = "inbox_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  inbox.push({
    objectId,
    title: title || "Imported chat",
    content,
    sourceProvider: sourceProvider || null,
    url: url || null,
    tags: Array.isArray(tags) ? tags : [],
    queuedAt: new Date().toISOString(),
  });
  writeInbox(inbox);
  res.status(201).json({ success: true, objectId });
});

// Web app → pull queued objects (localhost binding is the safety boundary)
app.get("/api/inbox", (_req, res) => {
  res.json(readInbox());
});

// Web app → clear synced entries
app.delete("/api/inbox", (_req, res) => {
  writeInbox([]);
  res.json({ success: true });
});

// Settings UI → show current token
app.get("/api/settings/token", (_req, res) => {
  res.json({ token: TOKEN });
});

app.listen(PORT, HOST, () => {
  console.log(`\n  Chronicle local API running at http://${HOST}:${PORT}`);
  console.log(`  Token: ${TOKEN}`);
  console.log(`  (paste this token into the extension popup & the app Settings)\n`);
});
