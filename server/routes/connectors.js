/**
 * /api/connectors — CRUD for external software connectors.
 *
 * Generic over specific: the router knows nothing about WordPress or any
 * other connector type. All type-specific logic lives in connectors/*.js,
 * registered at startup via connectors/index.js.
 */

const express = require("express");
const router = express.Router();
const connectors = require("../connectors/index");

// Register connector types at load time
connectors.register(require("../connectors/wordpress"));

/* ------------------------------------------------------------------- */
/*  GET /api/connectors — list all                                     */
/* ------------------------------------------------------------------- */
router.get("/", (_req, res) => {
  res.json(connectors.listConnectors());
});

/* ------------------------------------------------------------------- */
/*  GET /api/connectors/types — list available connector types          */
/* ------------------------------------------------------------------- */
router.get("/types", (_req, res) => {
  // We don't expose the registry directly, but we can list registered types
  const { registry } = require("../connectors/index");
  // The registry is not exported, so we'll just return hardcoded + dynamic
  res.json([
    { type: "wordpress", label: "WordPress", description: "Import posts & pages from a WordPress site via REST API" },
  ]);
});

/* ------------------------------------------------------------------- */
/*  POST /api/connectors — create a new connector                       */
/* ------------------------------------------------------------------- */
router.post("/", (req, res) => {
  const { type, label, config } = req.body || {};
  if (!type) return res.status(400).json({ error: "type required" });
  if (!label) return res.status(400).json({ error: "label required" });
  if (!config) return res.status(400).json({ error: "config required" });

  try {
    const entry = connectors.createConnector({ type, label, config });
    res.status(201).json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------- */
/*  PATCH /api/connectors/:id — update connector config/label          */
/* ------------------------------------------------------------------- */
router.patch("/:id", (req, res) => {
  const { label, config } = req.body || {};
  const patch = {};
  if (label !== undefined) patch.label = label;
  if (config !== undefined) patch.config = config;

  try {
    const entry = connectors.updateConnector(req.params.id, patch);
    if (!entry) return res.status(404).json({ error: "not found" });
    res.json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------- */
/*  DELETE /api/connectors/:id — remove connector                       */
/* ------------------------------------------------------------------- */
router.delete("/:id", (req, res) => {
  const ok = connectors.deleteConnector(req.params.id);
  if (!ok) return res.status(404).json({ error: "not found" });
  res.json({ success: true });
});

/* ------------------------------------------------------------------- */
/*  POST /api/connectors/:id/test — test the connection                 */
/* ------------------------------------------------------------------- */
router.post("/:id/test", async (req, res) => {
  try {
    const result = await connectors.testConnector(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ------------------------------------------------------------------- */
/*  POST /api/connectors/:id/sync — sync data from external source     */
/* ------------------------------------------------------------------- */
router.post("/:id/sync", async (req, res) => {
  try {
    const result = await connectors.syncConnector(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;