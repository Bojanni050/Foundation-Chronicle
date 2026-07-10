const express = require("express");
const { pool } = require("../db");
const { assertStatusChangeAllowed } = require("../statusPromotion");

const router = express.Router();

// GET /api/specialist
router.get("/", async (req, res) => {
  let query = "SELECT * FROM specialist WHERE status != 'rejected' ORDER BY created_at DESC";
  if (req.query.all === "true") query = "SELECT * FROM specialist ORDER BY created_at DESC";
  const { rows } = await pool.query(query);
  res.json(rows);
});

// POST /api/specialist — create an observation candidate, or reinforce an
// existing one if the same onderwerp already exists (case-insensitive match
// on the topic string is enough here — unlike persona_kenmerk, specialists
// are coarse categories like app names, not fuzzy natural-language traits,
// so no embedding-based duplicate detection is needed).
router.post("/", async (req, res) => {
  const { onderwerp, bronObjectId } = req.body || {};
  if (!onderwerp || !bronObjectId) return res.status(400).json({ error: "onderwerp and bronObjectId required" });

  const { rows: existingRows } = await pool.query(
    "SELECT * FROM specialist WHERE lower(onderwerp) = lower($1) AND status != 'rejected'",
    [onderwerp]
  );
  const existing = existingRows[0];
  if (existing) {
    const bronObjectIds = existing.bron_object_ids.includes(bronObjectId)
      ? existing.bron_object_ids
      : [...existing.bron_object_ids, bronObjectId];
    const { rows } = await pool.query(
      "UPDATE specialist SET bron_object_ids = $1 WHERE id = $2 RETURNING *",
      [bronObjectIds, existing.id]
    );
    return res.status(200).json({ ...rows[0], reinforced: true });
  }

  // No active match — check for a mens-rejected specialist that might be
  // resurrecting with new evidence (Manifest §5, "Heropstanding"). Same rule
  // as persona_kenmerk: a genuinely new bronObjectId is required, prior
  // evidence keeps counting, and the record comes back as "hypothesis" (never
  // a bare "observation" again, and never auto-confirmed), linked via voorganger_id.
  const { rows: rejectedRows } = await pool.query(
    "SELECT * FROM specialist WHERE lower(onderwerp) = lower($1) AND status = 'rejected' AND verwerp_bron = 'mens'",
    [onderwerp]
  );
  const rejected = rejectedRows[0];
  if (rejected && !rejected.bron_object_ids.includes(bronObjectId)) {
    const mergedBronObjectIds = [...rejected.bron_object_ids, bronObjectId];
    const { rows } = await pool.query(
      `INSERT INTO specialist (onderwerp, bron_object_ids, status, voorganger_id)
       VALUES ($1, $2, 'hypothesis', $3) RETURNING *`,
      [rejected.onderwerp, mergedBronObjectIds, rejected.id]
    );
    return res.status(201).json({ ...rows[0], resurrected: true });
  }

  const { rows } = await pool.query(
    "INSERT INTO specialist (onderwerp, bron_object_ids) VALUES ($1, ARRAY[$2]) RETURNING *",
    [onderwerp, bronObjectId]
  );
  res.status(201).json({ ...rows[0], reinforced: false });
});

// PATCH /api/specialist/:id — owner edits (systemPrompt, model, onderwerp),
// always allowed regardless of status — the system prompt is AI-authored on
// confirm but never opaque or locked.
router.patch("/:id", async (req, res) => {
  const { systemPrompt, model, onderwerp } = req.body || {};
  const fields = [];
  const values = [];
  let idx = 1;
  if (systemPrompt !== undefined) { fields.push(`system_prompt = $${idx++}`); values.push(systemPrompt); }
  if (model !== undefined) { fields.push(`model = $${idx++}`); values.push(model || null); }
  if (onderwerp !== undefined) { fields.push(`onderwerp = $${idx++}`); values.push(onderwerp); }
  if (!fields.length) return res.status(400).json({ error: "nothing to update" });
  values.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE specialist SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

// PATCH /api/specialist/:id/bevestigen — confirm. The AI-authored system
// prompt is generated client-side (same reason the LLM call itself lives in
// the frontend) and passed in here to persist.
router.patch("/:id/bevestigen", async (req, res) => {
  const { systemPrompt } = req.body || {};
  if (!systemPrompt) return res.status(400).json({ error: "systemPrompt required" });
  try {
    await assertStatusChangeAllowed(pool, "specialist", req.params.id, "confirmed");
  } catch (err) {
    return res.status(409).json({ error: err.message });
  }
  const { rows } = await pool.query(
    `UPDATE specialist SET status = 'confirmed', system_prompt = $1, confirmed_at = now() WHERE id = $2 RETURNING *`,
    [systemPrompt, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

// PATCH /api/specialist/:id/verwerpen
router.patch("/:id/verwerpen", async (req, res) => {
  try {
    await assertStatusChangeAllowed(pool, "specialist", req.params.id, "rejected");
  } catch (err) {
    return res.status(409).json({ error: err.message });
  }
  // Always a mens-rejectie here — there's no automated consolidation path
  // for specialists (unlike persona_kenmerk), every rejection is explicit.
  const { rows } = await pool.query(
    "UPDATE specialist SET status = 'rejected', verwerp_bron = 'mens' WHERE id = $1 RETURNING *",
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

module.exports = router;
