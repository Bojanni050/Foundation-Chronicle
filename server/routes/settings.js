const express = require("express");
const { TOKEN } = require("../auth");
const { getModel: getEmbeddingModel, setModel: setEmbeddingModel, MODEL_OPTIONS } = require("../embedding");
const { reembedAllRows } = require("../reembed");
const { getGaiaHermesConfig } = require("../gaia-backend/gaiaHermesManager");

const router = express.Router();

// GET /api/settings/gaia-hermes-config — url + key for Gaia's self-contained
// Hermes backend. Read fresh from the backend's own .env on every request
// rather than ever persisting the key in frontend localStorage — the prior
// chatEndpoint/chatKey mechanism cached stale client-side values and that
// caused persistent errors.
router.get("/gaia-hermes-config", (_req, res) => {
  res.json(getGaiaHermesConfig());
});

// gaia-hermes/chat/completions used to be proxied from here too. Removed —
// routes/gaiaHermesProxy.js (mounted at /api/settings/gaia-hermes) is now
// the single implementation; it also carries session tracking, reasoning
// capture, and the enabled-skills policy gate that this older copy lacked.

// GET /api/settings/token
router.get("/token", (_req, res) => {
  res.json({ token: TOKEN });
});

// GET /api/settings/embedding-model
router.get("/embedding-model", (_req, res) => {
  res.json({ model: getEmbeddingModel(), options: MODEL_OPTIONS });
});

// PATCH /api/settings/embedding-model
router.patch("/embedding-model", (req, res) => {
  try {
    const oldModel = getEmbeddingModel();
    const newModel = req.body?.model;
    if (!newModel) return res.status(400).json({ error: "model required" });

    setEmbeddingModel(newModel);

    // Trigger batch re-embedding if model changed
    if (newModel !== oldModel) {
      reembedAllRows().catch((err) => console.error("[Migration] Background re-embedding failed:", err.message));
    }

    res.json({ model: getEmbeddingModel(), options: MODEL_OPTIONS });
  } catch (err) {
    res.status(400).json({ error: err.message || "unknown embedding model" });
  }
});

// POST /api/settings/seed — Populate persona database tables with rich demo data
router.post("/seed", async (req, res) => {
  const { pool } = require("../db");
  const { embed } = require("../embedding");
  
  try {
    // 1. Clear existing traits & cache
    await pool.query("DELETE FROM persona_kenmerk_gebruik");
    await pool.query("DELETE FROM persona_pulse_cache");
    await pool.query("DELETE FROM persona_kenmerk");

    // 2. Setup the traits list
    const traits = [
      {
        kenmerk: "prefers Go over Node.js for backend projects",
        soort: "patroon",
        status: "confirmed",
        zekerheid: 95,
        temporal_text: "as of March 2026",
        bron_object_ids: ["obj_demo_1", "obj_demo_2", "obj_demo_3"]
      },
      {
        kenmerk: "prefers Node.js for local web servers",
        soort: "patroon",
        status: "rejected",
        zekerheid: 40,
        temporal_text: "valid until February 2026"
      },
      {
        kenmerk: "advocates for local-first database architectures",
        soort: "feit",
        status: "confirmed",
        zekerheid: 100,
        temporal_text: "always",
        bron_object_ids: ["obj_demo_4"]
      },
      {
        kenmerk: "actively learning Go programming",
        soort: "patroon",
        status: "confirmed",
        zekerheid: 90,
        temporal_text: "since February 2026",
        bron_object_ids: ["obj_demo_2", "obj_demo_5"]
      },
      {
        kenmerk: "learning Rust compiler internals",
        soort: "patroon",
        status: "observation",
        zekerheid: 30,
        temporal_text: "in April 2026",
        bron_object_ids: ["obj_demo_6"]
      },
      {
        kenmerk: "prefers python for data science",
        soort: "patroon",
        status: "rejected",
        zekerheid: 0,
        verwerp_reden: "User explicitly rejected this suggestion in settings."
      }
    ];

    // 3. Generate embeddings and save
    const savedRows = [];
    for (const t of traits) {
      let embeddingLiteral = null;
      try {
        embeddingLiteral = `[${(await embed(t.kenmerk)).join(",")}]`;
      } catch (err) {
        console.error(`seeding embedding failed for "${t.kenmerk}":`, err.message);
      }
      
      const { rows } = await pool.query(
        `INSERT INTO persona_kenmerk (
          kenmerk, soort, status, zekerheid, temporal_text, bron_object_ids, verwerp_reden, embedding
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          t.kenmerk,
          t.soort,
          t.status,
          t.zekerheid,
          t.temporal_text || null,
          t.bron_object_ids || [],
          t.verwerp_reden || null,
          embeddingLiteral
        ]
      );
      savedRows.push(rows[0]);
    }

    // 4. Wire the replacement (vervangen_door) relationship for demonstrating Hindsight
    const goTrait = savedRows.find(r => r.kenmerk.includes("prefers Go"));
    const nodeTrait = savedRows.find(r => r.kenmerk.includes("prefers Node.js"));
    if (goTrait && nodeTrait) {
      await pool.query(
        "UPDATE persona_kenmerk SET vervangen_door = $1 WHERE id = $2",
        [goTrait.id, nodeTrait.id]
      );
    }

    res.json({ success: true, count: savedRows.length });
  } catch (err) {
    console.error("seeding failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
