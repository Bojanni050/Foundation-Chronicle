const express = require("express");
const { requireAuth } = require("../auth");
const { pushToInbox } = require("../inboxStore");

const router = express.Router();

// POST /api/activity/import — the Chronicle activity-agent's only entry
// point. It sends one call per completed focus session (window changed, or
// a periodic safety flush for long-lived sessions), already deduped and
// buffered on its own side — this route just queues what it's given, same
// as the extension's /api/objects/import.
router.post("/import", requireAuth, (req, res) => {
  const { appName, windowTitle, content, occurredAt } = req.body || {};
  if (!content) return res.status(400).json({ error: "content required" });

  const objectId = "inbox_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  const title = windowTitle ? `${appName || "Onbekende app"} — ${windowTitle}` : appName || "Activiteit";

  pushToInbox({
    objectId,
    type: "activity",
    source: "chronicle-agent",
    title,
    content,
    sourceProvider: "chronicle-agent",
    tags: [appName].filter(Boolean),
    url: null,
    turns: [],
    queuedAt: new Date().toISOString(),
    occurredAt: occurredAt || null,
  });
  res.status(201).json({ success: true, objectId });
});

module.exports = router;
