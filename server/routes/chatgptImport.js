// Controls for the ChatGPT bulk importer (tools/chatgpt_bulk_import) — a
// Python/Playwright script that walks a logged-in ChatGPT session and posts
// every conversation to /api/objects/import. Chronicle spawns/tracks it here
// the same way gaia-backend/gaiaHermesManager.js manages the Hermes gateway.
const express = require("express");
const { startBulkImport, stopBulkImport, getStatus } = require("../chatgptImportManager");

const router = express.Router();

router.get("/status", (_req, res) => {
  res.json(getStatus());
});

// POST /api/settings/chatgpt-import/start  { limit?: number, headless?: boolean }
router.post("/start", (req, res) => {
  const { limit, headless } = req.body || {};
  const result = startBulkImport({ limit, headless });
  if (!result.started) return res.status(409).json(result);
  res.json(result);
});

router.post("/stop", (_req, res) => {
  const result = stopBulkImport();
  if (!result.stopped) return res.status(409).json(result);
  res.json(result);
});

module.exports = router;
