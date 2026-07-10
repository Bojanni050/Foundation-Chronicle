// "Gaia wants to talk about this" queue — flagged by the background
// consolidator (contradictions it won't silently merge away) and by new
// high-confidence kenmerk inserts (notable_fact). The frontend polls
// getUnresolvedTopics() and resolves one once it's been shown to the user.
const { pool } = require("./db");

async function flagContradiction(kenmerkIdA, kenmerkIdB, summary) {
  const { rows } = await pool.query(
    `INSERT INTO gaia_proactive_topic (kind, summary, kenmerk_ids)
     VALUES ('contradiction', $1, $2) RETURNING *`,
    [summary, [kenmerkIdA, kenmerkIdB]]
  );
  return rows[0];
}

async function flagNotableFact(kenmerkId, summary) {
  const { rows } = await pool.query(
    `INSERT INTO gaia_proactive_topic (kind, summary, kenmerk_ids)
     VALUES ('notable_fact', $1, $2) RETURNING *`,
    [summary, [kenmerkId]]
  );
  return rows[0];
}

// Guards against re-flagging the same still-unresolved contradiction every
// consolidator run (every 5 minutes) — a pair that's already pending doesn't
// need a second topic row just because it's still similar next time around.
async function hasUnresolvedTopicFor(kenmerkId) {
  const { rows } = await pool.query(
    "SELECT 1 FROM gaia_proactive_topic WHERE resolved_at IS NULL AND $1 = ANY(kenmerk_ids) LIMIT 1",
    [kenmerkId]
  );
  return rows.length > 0;
}

async function getUnresolvedTopics() {
  const { rows } = await pool.query(
    "SELECT * FROM gaia_proactive_topic WHERE resolved_at IS NULL ORDER BY created_at ASC"
  );
  return rows;
}

async function resolveTopic(id) {
  const { rows } = await pool.query(
    "UPDATE gaia_proactive_topic SET resolved_at = now() WHERE id = $1 AND resolved_at IS NULL RETURNING *",
    [id]
  );
  return rows[0] || null;
}

module.exports = { flagContradiction, flagNotableFact, getUnresolvedTopics, resolveTopic, hasUnresolvedTopicFor };
