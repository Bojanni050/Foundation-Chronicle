require("dotenv").config();

// Global safety net: a crash anywhere in an async/background path (Gaia's
// Hermes subprocess wiring, background jobs, etc.) must never take down the
// whole Chronicle server — that's a much bigger blast radius than whatever
// actually failed. Anything genuinely fatal to Express itself still surfaces
// via its own request-handler error path, unaffected by this.
process.on("uncaughtException", (err) => {
  console.error("[Chronicle] Uncaught exception (server stays up):", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[Chronicle] Unhandled promise rejection (server stays up):", reason);
});

const express = require("express");
const cors = require("cors");
const { TOKEN, requireAuth } = require("./auth");
const { startBackgroundJobs } = require("./jobs");
const { readInbox, writeInbox, pushToInbox } = require("./inboxStore");
const { startGaiaHermes, stopGaiaHermes, registerSpecialistsMcp } = require("./gaia-backend/gaiaHermesManager");

const gaiaHermesRouter = require("./routes/gaiaHermes");
const settingsRouter = require("./routes/settings");
const personaRouter = require("./routes/persona");
const embeddingRouter = require("./routes/embedding");
const specialistRouter = require("./routes/specialist");
const gaiaHermesProxyRouter = require("./routes/gaiaHermesProxy");
const chatgptImportRouter = require("./routes/chatgptImport");

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

// Mounted BEFORE express.json(): the MCP SDK's StreamableHTTPServerTransport
// needs to read the raw request stream itself. Running express.json() first
// consumes/ends that stream before the transport ever sees it, which hangs
// every request indefinitely (no error, just a stuck connection) — this is
// why it must sit ahead of the body-parsing middleware below, not after it
// alongside the other /api/* sub-routers.
app.use("/mcp/specialists", require("./gaia-backend/specialistsMcpServer"));

app.use(express.json({ limit: "10mb" }));

// Mount Sub-routers. Gaia Hermes goes first so its guarded chat proxy shadows
// the legacy proxy route in settings.js.
app.use("/api/settings", gaiaHermesRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/persona", personaRouter);
app.use("/api/specialist", specialistRouter);
app.use("/api/objects", embeddingRouter); // POST /api/objects/:objectId/embed
app.use("/api/settings/gaia-hermes", gaiaHermesProxyRouter);
app.use("/api/settings/chatgpt-import", chatgptImportRouter);

// Extension → queue a chat object
app.post("/api/objects/import", requireAuth, (req, res) => {
  const { title, content, sourceProvider, url, tags, turns, occurredAt } = req.body || {};
  if (!content) return res.status(400).json({ error: "content required" });
  const objectId = "inbox_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  pushToInbox({
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

  // Only safe to register now: `hermes mcp add` connects to this URL
  // immediately to discover tools, so it needs Chronicle actually listening.
  // Fire-and-forget — this must never delay or block startup.
  registerSpecialistsMcp();
});

function shutdown() {
  console.log("\n  Shutting down Chronicle...");
  stopGaiaHermes();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
