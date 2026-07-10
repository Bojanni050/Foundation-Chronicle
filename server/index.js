require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { TOKEN, requireAuth } = require("./auth");
const { startBackgroundJobs } = require("./jobs");
const { readInbox, writeInbox } = require("./inboxStore");
const { startGaiaHermes, stopGaiaHermes } = require("./gaia-backend/gaiaHermesManager");

const settingsRouter = require("./routes/settings");
const personaRouter = require("./routes/persona");
const embeddingRouter = require("./routes/embedding");
const specialistRouter = require("./routes/specialist");

const HOST = "127.0.0.1"; // localhost-only — never 0.0.0.0
const PORT = process.env.CHRONICLE_PORT || 4577;

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
app.use("/api/specialist", specialistRouter);
app.use("/api/objects", embeddingRouter); // POST /api/objects/:objectId/embed

// Extension → queue a chat object
app.post("/api/objects/import", requireAuth, (req, res) => {
  const { title, content, sourceProvider, url, tags, turns, occurredAt } = req.body || {};
  if (!content) return res.status(400).json({ error: "content required" });
  const inbox = readInbox();
  const objectId = "inbox_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  inbox.push({
    objectId,
    type: "chat",
    source: "extension",
    title: title || "Imported chat",
    content,
    sourceProvider: sourceProvider || null,
    url: url || null,
    tags: Array.isArray(tags) ? tags : [],
    // Structured role/text turns, kept alongside the flattened `content` so
    // the frontend can request message-level embeddings after import without
    // re-scraping. Optional — older extension versions won't send this.
    turns: Array.isArray(turns) ? turns : [],
    queuedAt: new Date().toISOString(),
    occurredAt: occurredAt || null,
  });
  writeInbox(inbox);
  res.status(201).json({ success: true, objectId });
});

// Web app → pull queued objects (localhost binding is the safety boundary)
app.get("/api/inbox", (_req, res) => {
  res.json(readInbox());
});

// POST /api/inbox/claim — atomic read-and-clear, in one request. Prevents
// the race that GET-then-later-DELETE has: if two separate frontend clients
// (e.g. a browser tab and the Tauri app, which have entirely separate
// IndexedDB storage) both poll the inbox, a plain GET can hand the same
// items to both before either gets around to clearing it. Since readInbox()/
// writeInbox() are synchronous, doing both within one handler — with no
// `await` in between — can't be interleaved by another request in Node's
// single-threaded event loop, so exactly one caller ever receives each item.
app.post("/api/inbox/claim", (_req, res) => {
  const items = readInbox();
  writeInbox([]);
  res.json(items);
});

// Web app → clear synced entries
app.delete("/api/inbox", (_req, res) => {
  writeInbox([]);
  res.json({ success: true });
});

// Start background jobs (auto-heal, consolidator)
startBackgroundJobs();

// Start Gaia's self-contained Hermes backend (isolated, own HERMES_HOME)
startGaiaHermes();

const server = app.listen(PORT, HOST, () => {
  console.log(`\n  Chronicle local API running at http://${HOST}:${PORT}`);
  console.log(`  Token: ${TOKEN}`);
  console.log(`  (paste this token into the extension popup & the app Settings)\n`);
});

function shutdown() {
  console.log("\n  Shutting down Chronicle...");
  stopGaiaHermes();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
