// Surfaces "Gaia wants to talk about this" items to the frontend — polled
// periodically (see frontend/src/services/gaiaProactive.js) rather than
// pushed, matching this codebase's existing polling-only convention.
const express = require("express");
const { getUnresolvedTopics, resolveTopic } = require("../../gaiaProactiveTopics");

const router = express.Router();

// GET /api/persona/proactive-topics
router.get("/proactive-topics", async (_req, res) => {
  const topics = await getUnresolvedTopics();
  res.json(topics);
});

// POST /api/persona/proactive-topics/:id/resolve
router.post("/proactive-topics/:id/resolve", async (req, res) => {
  const resolved = await resolveTopic(req.params.id);
  if (!resolved) return res.status(404).json({ error: "not found or already resolved" });
  res.json(resolved);
});

module.exports = router;
