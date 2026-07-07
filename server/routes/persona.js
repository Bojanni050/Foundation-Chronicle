const express = require("express");
const { pool } = require("../db");
const { embed } = require("../embedding");
const { getOrCreateInstelling, computePromotion } = require("../personaHelper");
const { consolidateKenmerken } = require("../jobs");

const router = express.Router();

// GET /api/persona/instelling
router.get("/instelling", async (_req, res) => {
  res.json(await getOrCreateInstelling());
});

// PATCH /api/persona/instelling
router.patch("/instelling", async (req, res) => {
  const current = await getOrCreateInstelling();
  const confidenceThreshold = req.body?.confidenceThreshold ?? current.confidence_threshold;
  const promotieMinBronnen = req.body?.promotieMinBronnen ?? current.promotie_min_bronnen;
  const skepticism = req.body?.skepticism ?? current.skepticism;
  const literalism = req.body?.literalism ?? current.literalism;
  const empathy = req.body?.empathy ?? current.empathy;
  const { rows } = await pool.query(
    `UPDATE persona_instelling
     SET confidence_threshold = $1, promotie_min_bronnen = $2, skepticism = $3, literalism = $4, empathy = $5, updated_at = now()
     WHERE id = $6 RETURNING *`,
    [confidenceThreshold, promotieMinBronnen, skepticism, literalism, empathy, current.id]
  );
  res.json(rows[0]);
});

// GET /api/persona/pulse — cached "mental model" of the last generated digest
router.get("/pulse", async (_req, res) => {
  const { rows } = await pool.query("SELECT * FROM persona_pulse_cache ORDER BY generated_at DESC LIMIT 1");
  res.json(rows[0] || null);
});

// POST /api/persona/pulse — overwrite the cache with a freshly generated digest
router.post("/pulse", async (req, res) => {
  const { items, aiUsed } = req.body || {};
  if (!Array.isArray(items)) return res.status(400).json({ error: "items array required" });
  await pool.query("DELETE FROM persona_pulse_cache");
  const { rows } = await pool.query(
    "INSERT INTO persona_pulse_cache (items, ai_used) VALUES ($1, $2) RETURNING *",
    [items, !!aiUsed]
  );
  res.status(201).json(rows[0]);
});

// GET /api/persona/kenmerken
router.get("/kenmerken", async (req, res) => {
  const status = req.query.status;
  let query = "SELECT * FROM persona_kenmerk WHERE status != 'rejected' ORDER BY zekerheid DESC, created_at DESC";
  if (status === "rejected") {
    query = "SELECT * FROM persona_kenmerk WHERE status = 'rejected' ORDER BY created_at DESC";
  } else if (req.query.all === "true" || status === "all") {
    query = "SELECT * FROM persona_kenmerk ORDER BY zekerheid DESC, created_at DESC";
  }
  const { rows } = await pool.query(query);
  res.json(rows);
});

// POST /api/persona/kenmerken
router.post("/kenmerken", async (req, res) => {
  const { kenmerk, bronObjectId, soort, gevoelig } = req.body || {};
  if (!kenmerk || !bronObjectId) return res.status(400).json({ error: "kenmerk and bronObjectId required" });
  const soortValue = soort === "feit" ? "feit" : "patroon";

  // 1. Generate local embedding
  let embeddingLiteral = null;
  try {
    embeddingLiteral = `[${(await embed(kenmerk)).join(",")}]`;
  } catch (err) {
    console.error("local embedding failed, saving kenmerk without one:", err.message);
  }

  // 2. Perform vector duplicate detection if embedding is available
  if (embeddingLiteral) {
    try {
      const { rows: matches } = await pool.query(
        `SELECT *, 1 - (embedding <=> $1) AS similarity
         FROM persona_kenmerk
         WHERE embedding IS NOT NULL AND status != 'rejected'
         ORDER BY embedding <=> $1
         LIMIT 1`,
        [embeddingLiteral]
      );
      const bestMatch = matches[0];
      if (bestMatch && bestMatch.similarity > 0.82) {
        // High similarity: Reinforce the matched trait
        const bronObjectIds = bestMatch.bron_object_ids.includes(bronObjectId)
          ? bestMatch.bron_object_ids
          : [...bestMatch.bron_object_ids, bronObjectId];
        const instelling = await getOrCreateInstelling();
        const { zekerheid, status } = computePromotion(
          bronObjectIds,
          instelling.promotie_min_bronnen,
          bestMatch.status,
          bestMatch.soort
        );
        const { rows } = await pool.query(
          `UPDATE persona_kenmerk SET bron_object_ids = $1, zekerheid = $2, status = $3, laatst_versterkt_op = now()
           WHERE id = $4 RETURNING *`,
          [bronObjectIds, zekerheid, status, bestMatch.id]
        );
        return res.status(200).json({ ...rows[0], reinforced: true });
      }
    } catch (err) {
      console.error("Server-side duplicate detection failed:", err.message);
    }
  }

  // 3. No match found or embedding failed: Create a new observation/fact
  const instelling = await getOrCreateInstelling();
  const { zekerheid, status } = computePromotion(
    [bronObjectId],
    instelling.promotie_min_bronnen,
    "observation",
    soortValue
  );

  const { rows } = await pool.query(
    `INSERT INTO persona_kenmerk (kenmerk, bron_object_ids, zekerheid, status, soort, gevoelig, embedding)
     VALUES ($1, ARRAY[$2], $3, $4, $5, $6, $7) RETURNING *`,
    [kenmerk, bronObjectId, zekerheid, status, soortValue, !!gevoelig, embeddingLiteral]
  );
  
  // Trigger consolidator in the background to handle instant duplicate merging
  consolidateKenmerken().catch((err) => console.error("[Consolidator] Immediate consolidator failed:", err.message));

  res.status(201).json({ ...rows[0], reinforced: false });
});

// GET /api/persona/kenmerken/:id/vergelijkbaar
router.get("/kenmerken/:id/vergelijkbaar", async (req, res) => {
  const { rows: cur } = await pool.query("SELECT embedding FROM persona_kenmerk WHERE id = $1", [req.params.id]);
  if (!cur[0]) return res.status(404).json({ error: "not found" });
  if (!cur[0].embedding) return res.status(409).json({ error: "kenmerk has no embedding yet" });
  const { rows } = await pool.query(
    `SELECT id, kenmerk, soort, zekerheid, status, 1 - (embedding <=> $1) AS gelijkenis
     FROM persona_kenmerk
     WHERE id != $2 AND embedding IS NOT NULL AND status != 'rejected'
     ORDER BY embedding <=> $1
     LIMIT 5`,
    [cur[0].embedding, req.params.id]
  );
  res.json(rows);
});

// PATCH /api/persona/kenmerken/:id/versterk
router.patch("/kenmerken/:id/versterk", async (req, res) => {
  const { bronObjectId } = req.body || {};
  if (!bronObjectId) return res.status(400).json({ error: "bronObjectId required" });
  const { rows: existingRows } = await pool.query("SELECT * FROM persona_kenmerk WHERE id = $1", [req.params.id]);
  const kenmerk = existingRows[0];
  if (!kenmerk) return res.status(404).json({ error: "not found" });
  if (kenmerk.status === "rejected") return res.status(409).json({ error: "kenmerk is rejected" });
  const bronObjectIds = kenmerk.bron_object_ids.includes(bronObjectId)
    ? kenmerk.bron_object_ids
    : [...kenmerk.bron_object_ids, bronObjectId];
  const instelling = await getOrCreateInstelling();
  const { zekerheid, status } = computePromotion(
    bronObjectIds,
    instelling.promotie_min_bronnen,
    kenmerk.status,
    kenmerk.soort
  );

  // Auto-heal embedding if it is null
  let embeddingLiteral = kenmerk.embedding;
  if (!embeddingLiteral) {
    try {
      embeddingLiteral = `[${(await embed(kenmerk.kenmerk)).join(",")}]`;
    } catch (err) {
      console.error("[Auto-Heal] local embedding failed in versterk:", err.message);
    }
  }

  const { rows } = await pool.query(
    `UPDATE persona_kenmerk 
     SET bron_object_ids = $1, zekerheid = $2, status = $3, laatst_versterkt_op = now(), embedding = COALESCE(embedding, $4)
     WHERE id = $5 RETURNING *`,
    [bronObjectIds, zekerheid, status, embeddingLiteral, req.params.id]
  );
  res.json(rows[0]);
});

// PATCH /api/persona/kenmerken/:id/bevestigen
router.patch("/kenmerken/:id/bevestigen", async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE persona_kenmerk SET status = 'confirmed', zekerheid = 100, laatst_versterkt_op = now()
     WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

// PATCH /api/persona/kenmerken/:id/verwerpen
router.patch("/kenmerken/:id/verwerpen", async (req, res) => {
  const { reden } = req.body || {};
  const { rows } = await pool.query(
    "UPDATE persona_kenmerk SET status = 'rejected', verwerp_reden = $1 WHERE id = $2 RETURNING *",
    [reden || null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

// PATCH /api/persona/kenmerken/:id/samenvoegen
router.patch("/kenmerken/:id/samenvoegen", async (req, res) => {
  const { winnaarId, reden } = req.body || {};
  if (!winnaarId || !reden) return res.status(400).json({ error: "winnaarId and reden required" });
  if (winnaarId === req.params.id) return res.status(400).json({ error: "kenmerk cannot merge into itself" });

  const { rows: loserRows } = await pool.query("SELECT * FROM persona_kenmerk WHERE id = $1", [req.params.id]);
  const loser = loserRows[0];
  if (!loser) return res.status(404).json({ error: "not found" });
  if (loser.status === "rejected") return res.status(409).json({ error: "kenmerk is already rejected" });

  const { rows: winnerRows } = await pool.query("SELECT * FROM persona_kenmerk WHERE id = $1", [winnaarId]);
  const winner = winnerRows[0];
  if (!winner) return res.status(404).json({ error: "winnaar not found" });
  if (winner.status === "rejected") return res.status(409).json({ error: "winnaar is rejected" });

  const mergedBronIds = Array.from(new Set([...winner.bron_object_ids, ...loser.bron_object_ids]));
  const instelling = await getOrCreateInstelling();
  const { zekerheid, status } = computePromotion(
    mergedBronIds,
    instelling.promotie_min_bronnen,
    winner.status,
    winner.soort
  );
  const { rows: updatedWinnerRows } = await pool.query(
    `UPDATE persona_kenmerk SET bron_object_ids = $1, zekerheid = $2, status = $3, laatst_versterkt_op = now()
     WHERE id = $4 RETURNING *`,
    [mergedBronIds, zekerheid, status, winnaarId]
  );

  const { rows: loserUpdatedRows } = await pool.query(
    `UPDATE persona_kenmerk SET status = 'rejected', vervangen_door = $1, verwerp_reden = $2
     WHERE id = $3 RETURNING *`,
    [winnaarId, reden, req.params.id]
  );

  res.json({ winnaar: updatedWinnerRows[0], verliezer: loserUpdatedRows[0] });
});

// POST /api/persona/kenmerken/:id/gebruik
router.post("/kenmerken/:id/gebruik", async (req, res) => {
  const { objectId, context } = req.body || {};
  if (!objectId || !context) return res.status(400).json({ error: "objectId and context required" });
  const { rows } = await pool.query(
    "INSERT INTO persona_kenmerk_gebruik (kenmerk_id, gebruikt_in_object_id, context) VALUES ($1, $2, $3) RETURNING *",
    [req.params.id, objectId, context]
  );
  res.status(201).json(rows[0]);
});

// POST /api/persona/reflectie — temporal reflection: reasons over how kenmerken
// evolved over time (validFrom/validTo/temporalText, supersession via vervangenDoor).
router.post("/reflectie", async (req, res) => {
  const { creations = [], updates = [] } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    
    const tempIdToUuid = {};
    const createdRows = [];

    // 1. Process creations
    for (const c of creations) {
      const soortValue = c.soort === "feit" ? "feit" : "patroon";
      const instelling = await getOrCreateInstelling();
      const { zekerheid, status } = computePromotion(
        [c.bronObjectId],
        instelling.promotie_min_bronnen,
        "observation",
        soortValue
      );
      
      let embeddingLiteral = null;
      try {
        embeddingLiteral = `[${(await embed(c.kenmerk)).join(",")}]`;
      } catch (err) {
        console.error("Embedding generation failed in reflect creation:", err.message);
      }

      const { rows } = await client.query(
        `INSERT INTO persona_kenmerk (kenmerk, bron_object_ids, zekerheid, status, soort, gevoelig, embedding, valid_from, temporal_text)
         VALUES ($1, ARRAY[$2], $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          c.kenmerk,
          c.bronObjectId,
          zekerheid,
          status,
          soortValue,
          !!c.gevoelig,
          embeddingLiteral,
          c.validFrom || null,
          c.temporalText || null
        ]
      );
      
      const createdObj = rows[0];
      createdRows.push(createdObj);
      if (c.temporaryId) {
        tempIdToUuid[c.temporaryId] = createdObj.id;
      }
    }

    // 2. Process updates
    for (const u of updates) {
      let vervangenDoorUuid = u.vervangenDoor || null;
      if (u.vervangenByTemporaryId && tempIdToUuid[u.vervangenByTemporaryId]) {
        vervangenDoorUuid = tempIdToUuid[u.vervangenByTemporaryId];
      }

      // Build fields dynamically
      const fields = [];
      const values = [];
      let idx = 1;
      
      if (u.validTo !== undefined) {
        fields.push(`valid_to = $${idx++}`);
        values.push(u.validTo);
      }
      if (u.temporalText !== undefined) {
        fields.push(`temporal_text = $${idx++}`);
        values.push(u.temporalText);
      }
      if (u.status !== undefined) {
        fields.push(`status = $${idx++}`);
        values.push(u.status);
      }
      if (u.verwerpReden !== undefined) {
        fields.push(`verwerp_reden = $${idx++}`);
        values.push(u.verwerpReden);
      }
      if (vervangenDoorUuid !== null) {
        fields.push(`vervangen_door = $${idx++}`);
        values.push(vervangenDoorUuid);
      }
      
      if (fields.length > 0) {
        fields.push(`laatst_versterkt_op = now()`);
        values.push(u.id); // for WHERE id = $idx
        const query = `UPDATE persona_kenmerk SET ${fields.join(", ")} WHERE id = $${idx}`;
        await client.query(query, values);
      }
    }

    await client.query("COMMIT");
    
    // Trigger consolidator to clean up any immediate overlaps
    consolidateKenmerken().catch((err) => console.error("[Consolidator] Immediate reflect consolidator failed:", err.message));

    res.json({ success: true, created: createdRows });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Temporal reflection transaction failed:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
