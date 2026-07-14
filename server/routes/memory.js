// Epistemic memory API — hypotheses, their evidence, and knowledge gaps
// (see db/schema.ts's "Epistemic memory" section for the data model, and
// epistemicPolicy.js for every rule enforced here). This module never
// computes a status transition itself — it only ever calls into
// epistemicPolicy and persists whatever patch that returns, so the actual
// promotion/rejection/transition rules live in exactly one place.
const express = require("express");
const { pool } = require("../db");
const {
  isVerified,
  confirmHypothesis,
  rejectHypothesis,
  transitionKnowledgeGap,
} = require("../epistemicPolicy");

const router = express.Router();

const EVIDENCE_DIRECTIONS = ["supporting", "contradicting", "contextualizing"];

// GET /api/memory/hypotheses?status=open|confirmed|rejected
router.get("/hypotheses", async (req, res) => {
  const { status } = req.query;
  const query =
    status && ["open", "confirmed", "rejected"].includes(status)
      ? { text: "SELECT * FROM hypothesis WHERE status = $1 ORDER BY created_at DESC", values: [status] }
      : { text: "SELECT * FROM hypothesis ORDER BY created_at DESC", values: [] };
  const { rows } = await pool.query(query.text, query.values);
  res.json(rows);
});

// POST /api/memory/hypotheses
router.post("/hypotheses", async (req, res) => {
  const { hypothese, verificatieCriteria, bevestigingsCriteria, afwijzingsCriteria } = req.body || {};
  if (!hypothese) return res.status(400).json({ error: "hypothese required" });
  const { rows } = await pool.query(
    `INSERT INTO hypothesis (hypothese, verificatie_criteria, bevestigings_criteria, afwijzings_criteria)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [hypothese, verificatieCriteria || null, bevestigingsCriteria || null, afwijzingsCriteria || null]
  );
  res.status(201).json(rows[0]);
});

// GET /api/memory/hypotheses/:id — detail + evidence + the current
// (read-only, never-stored) verification verdict.
router.get("/hypotheses/:id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM hypothesis WHERE id = $1", [req.params.id]);
  const hyp = rows[0];
  if (!hyp) return res.status(404).json({ error: "not found" });

  const { rows: evidenceRows } = await pool.query(
    "SELECT * FROM evidence WHERE hypothesis_id = $1 ORDER BY created_at ASC",
    [req.params.id]
  );
  const verdict = isVerified(evidenceRows);
  res.json({ ...hyp, evidence: evidenceRows, verdict });
});

// POST /api/memory/hypotheses/:id/evidence — attach one piece of evidence.
// Never touches hypothesis.status: adding evidence, however conclusive,
// is not the same act as a human confirming or rejecting the hypothesis.
router.post("/hypotheses/:id/evidence", async (req, res) => {
  const { richting, bronsoort, fragment, spreker, tijdstip, bronObjectId, bronReferentie, conversationIdentity } =
    req.body || {};
  if (!EVIDENCE_DIRECTIONS.includes(richting)) {
    return res.status(400).json({ error: `richting must be one of: ${EVIDENCE_DIRECTIONS.join(", ")}` });
  }
  if (!bronsoort || !fragment || !bronObjectId) {
    return res.status(400).json({ error: "bronsoort, fragment, and bronObjectId required" });
  }
  const { rows: hypRows } = await pool.query("SELECT id FROM hypothesis WHERE id = $1", [req.params.id]);
  if (!hypRows[0]) return res.status(404).json({ error: "hypothesis not found" });

  const { rows } = await pool.query(
    `INSERT INTO evidence
       (hypothesis_id, richting, bronsoort, fragment, spreker, tijdstip, bron_object_id, bron_referentie, conversation_identity)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      req.params.id,
      richting,
      bronsoort,
      fragment,
      spreker || null,
      tijdstip || null,
      bronObjectId,
      bronReferentie || null,
      conversationIdentity || null,
    ]
  );
  res.status(201).json(rows[0]);
});

// PATCH /api/memory/hypotheses/:id/confirm — the one explicit "a human
// confirmed this" action. Deliberately ignores the current verdict: a human
// can confirm a not-yet-"verified" hypothesis (their call, their evidence
// standard) or decline to confirm a "verified" one — the computed verdict
// is advisory, never load-bearing on its own.
router.patch("/hypotheses/:id/confirm", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM hypothesis WHERE id = $1", [req.params.id]);
  const hyp = rows[0];
  if (!hyp) return res.status(404).json({ error: "not found" });
  let patch;
  try {
    patch = confirmHypothesis(hyp);
  } catch (err) {
    return res.status(409).json({ error: err.message });
  }
  const { rows: updated } = await pool.query(
    "UPDATE hypothesis SET status = $1, confirmed_at = $2 WHERE id = $3 RETURNING *",
    [patch.status, patch.confirmedAt, req.params.id]
  );
  res.json(updated[0]);
});

// PATCH /api/memory/hypotheses/:id/reject  { reden: string }
router.patch("/hypotheses/:id/reject", async (req, res) => {
  const { reden } = req.body || {};
  const { rows } = await pool.query("SELECT * FROM hypothesis WHERE id = $1", [req.params.id]);
  const hyp = rows[0];
  if (!hyp) return res.status(404).json({ error: "not found" });
  let patch;
  try {
    patch = rejectHypothesis(hyp, { reden });
  } catch (err) {
    return res.status(err.message === "rejectHypothesis: reden required" ? 400 : 409).json({ error: err.message });
  }
  const { rows: updated } = await pool.query(
    "UPDATE hypothesis SET status = $1, rejected_at = $2, verwerp_reden = $3 WHERE id = $4 RETURNING *",
    [patch.status, patch.rejectedAt, patch.verwerpReden, req.params.id]
  );
  res.json(updated[0]);
});

// GET /api/memory/knowledge-gaps?status=...
router.get("/knowledge-gaps", async (req, res) => {
  const { status } = req.query;
  const valid = ["unknown", "not_asked", "known_absent", "resolved"];
  const query =
    status && valid.includes(status)
      ? { text: "SELECT * FROM knowledge_gap WHERE status = $1 ORDER BY created_at DESC", values: [status] }
      : { text: "SELECT * FROM knowledge_gap ORDER BY created_at DESC", values: [] };
  const { rows } = await pool.query(query.text, query.values);
  res.json(rows);
});

// POST /api/memory/knowledge-gaps  { onderwerp, hypothesisId? }
router.post("/knowledge-gaps", async (req, res) => {
  const { onderwerp, hypothesisId } = req.body || {};
  if (!onderwerp) return res.status(400).json({ error: "onderwerp required" });
  const { rows } = await pool.query(
    "INSERT INTO knowledge_gap (onderwerp, hypothesis_id) VALUES ($1, $2) RETURNING *",
    [onderwerp, hypothesisId || null]
  );
  res.status(201).json(rows[0]);
});

// PATCH /api/memory/knowledge-gaps/:id/status  { status, hypothesisId? }
// hypothesisId is optional and only meaningful when transitioning to
// "resolved" — links the gap to whatever hypothesis actually answered it.
router.patch("/knowledge-gaps/:id/status", async (req, res) => {
  const { status, hypothesisId } = req.body || {};
  const { rows } = await pool.query("SELECT * FROM knowledge_gap WHERE id = $1", [req.params.id]);
  const gap = rows[0];
  if (!gap) return res.status(404).json({ error: "not found" });
  let patch;
  try {
    patch = transitionKnowledgeGap(gap, status);
  } catch (err) {
    return res.status(409).json({ error: err.message });
  }
  const { rows: updated } = await pool.query(
    `UPDATE knowledge_gap
     SET status = $1, resolved_at = $2, hypothesis_id = COALESCE($3, hypothesis_id)
     WHERE id = $4 RETURNING *`,
    [patch.status, patch.resolvedAt || null, hypothesisId || null, req.params.id]
  );
  res.json(updated[0]);
});

module.exports = router;
