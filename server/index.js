require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { TOKEN, requireAuth } = require("./auth");
const { startBackgroundJobs } = require("./jobs");

const settingsRouter = require("./routes/settings");
const personaRouter = require("./routes/persona");

const HOST = "127.0.0.1"; // localhost-only — never 0.0.0.0
const PORT = process.env.CHRONICLE_PORT || 4577;

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
  fs.writeFileSync(INBOX_FILE, JSON.stringify(arr, null, 2));
}

const allowedOriginsPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$|^chrome-extension:\/\//;

const app = express();
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOriginsPattern.test(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("Not allowed by CORS"));
      }
    },
  })
);

// Enforce safe origins at routing level to block CSRF and unauthorized cross-origin requests
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !allowedOriginsPattern.test(origin)) {
    return res.status(403).json({ error: "Forbidden origin" });
  }
  next();
});

app.use(express.json({ limit: "10mb" }));

// Mount Sub-routers
app.use("/api/settings", settingsRouter);
app.use("/api/persona", personaRouter);
app.use("/api/screenpipe", require("./routes/screenpipe"));

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

// Start background jobs (auto-heal, consolidator)
startBackgroundJobs();

app.listen(PORT, HOST, () => {
  console.log(`\n  Chronicle local API running at http://${HOST}:${PORT}`);
  console.log(`  Token: ${TOKEN}`);
  console.log(`  (paste this token into the extension popup & the app Settings)\n`);
});
