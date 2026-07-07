const { pool } = require("./db");

async function getOrCreateInstelling() {
  const { rows } = await pool.query("SELECT * FROM persona_instelling LIMIT 1");
  if (rows[0]) return rows[0];
  const inserted = await pool.query("INSERT INTO persona_instelling DEFAULT VALUES RETURNING *");
  return inserted.rows[0];
}

function computePromotion(bronObjectIds, promotieMinBronnen, currentStatus, soort) {
  if (currentStatus === "confirmed") return { zekerheid: 100, status: "confirmed" };
  if (soort === "feit") return { zekerheid: 100, status: currentStatus };
  const zekerheid = Math.min(100, Math.round((100 * bronObjectIds.length) / promotieMinBronnen));
  const status =
    currentStatus === "observation" && bronObjectIds.length >= promotieMinBronnen
      ? "hypothesis"
      : currentStatus;
  return { zekerheid, status };
}

module.exports = { getOrCreateInstelling, computePromotion };
