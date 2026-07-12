// File attachments (images, etc.) linked to an object — e.g. images pulled
// out of a ChatGPT conversation by the bulk importer. Stored on local disk
// (server/data/attachments/), never in the frontend's IndexedDB: objects
// there only ever carry attachment *metadata* (id/filename/mimeType/url),
// keeping large binaries out of browser storage.
const express = require("express");
const { requireAuth } = require("../auth");
const { saveAttachment, getAttachment } = require("../attachmentsStore");

const router = express.Router();

const MAX_SIZE = 25 * 1024 * 1024; // generous for chat images/screenshots

// POST /api/attachments — raw binary body. Filename via X-Attachment-Filename
// (URL-encoded), mime type via Content-Type. Requires the same bearer token
// as /api/objects/import — both are write paths for external tools (browser
// extension, bulk importer), not just the app's own UI.
router.post("/", requireAuth, express.raw({ type: "*/*", limit: "25mb" }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    return res.status(400).json({ error: "empty body" });
  }
  if (req.body.length > MAX_SIZE) {
    return res.status(413).json({ error: "file too large (25MB max)" });
  }
  const rawFilename = req.get("X-Attachment-Filename") || "file";
  let filename;
  try {
    filename = decodeURIComponent(rawFilename);
  } catch {
    filename = rawFilename;
  }
  const mimeType = req.get("Content-Type") || "application/octet-stream";
  const meta = saveAttachment(req.body, filename, mimeType);
  res.status(201).json({
    id: meta.id,
    filename: meta.filename,
    mimeType: meta.mimeType,
    size: meta.size,
    url: `/api/attachments/${meta.id}/${encodeURIComponent(meta.filename)}`,
  });
});

// GET /api/attachments/:id/:filename — no auth: this is what <img src> tags
// in the app's own UI hit directly, and browsers don't attach bearer tokens
// to those requests. Localhost-only binding + the origin check in
// server/index.js are the security boundary here, same as GET /api/inbox.
router.get("/:id/:filename", (req, res) => {
  const attachment = getAttachment(req.params.id);
  if (!attachment) return res.status(404).json({ error: "not found" });
  res.setHeader("Content-Type", attachment.mimeType);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); // content-addressed — safe to cache hard
  res.sendFile(attachment.filePath);
});

module.exports = router;
