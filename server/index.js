require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pool } = require("./db");
const { embed, getModel: getEmbeddingModel, setModel: setEmbeddingModel, MODEL_OPTIONS } = require("./embedding");
const { reembedAllRows } = require("./reembed");

const HOST = "127.0.0.1"; // localhost-only — never 0.0.0.0
const PORT = process.env.CHRONICLE_PORT || 4577;

const DATA_DIR = path.join(__dirname, "data");
const INBOX_FILE = path.join(DATA_DIR, "inbox.json");
const TOKEN_FILE = path.join(DATA_DIR, "token.txt");

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(INBOX_FILE)) fs.writeFileSync(INBOX_FILE, "[]");
}

function getToken() {
  ensureData();
  if (!fs.existsSync(TOKEN_FILE)) {
    const token = crypto.randomBytes(24).toString("hex");
    fs.writeFileSync(TOKEN_FILE, token);
    return token;
  }
  return fs.readFileSync(TOKEN_FILE, "utf8").trim();
}

function readInbox() {
  ensureData();
  try {
    return JSON.parse(fs.readFileSync(INBOX_FILE, "utf8") || "[]");
  } catch {
    return [];
  }
}

function writeInbox(arr) {
  fs.writeFileSync(INBOX_FILE, JSON.stringify(arr, null, 2));
}

const TOKEN = getToken();

const app = express();
app.use(cors()); // safe: server only listens on 127.0.0.1
app.use(express.json({ limit: "10mb" }));

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (token !== TOKEN) return res.status(401).json({ error: "unauthorized" });
  next();
}

// Extension → queue a chat object
app.post("/api/objects/import", requireAuth, (req, res) => {
  const { title, content, sourceProvider, url, tags } = req.body || {};
  if (!content) return res.status(400).json({ error: "content required" });
  const inbox = readInbox();
  const objectId = "inbox_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  inbox.push({
    objectId,
    title: title || "Imported chat",
    content,
    sourceProvider: sourceProvider || null,
    url: url || null,
    tags: Array.isArray(tags) ? tags : [],
    queuedAt: new Date().toISOString(),
  });
  writeInbox(inbox);
  res.status(201).json({ success: true, objectId });
});

// Web app → pull queued objects (localhost binding is the safety boundary)
app.get("/api/inbox", (_req, res) => {
  res.json(readInbox());
});

// Web app → clear synced entries
app.delete("/api/inbox", (_req, res) => {
  writeInbox([]);
  res.json({ success: true });
});

// Settings UI → show current token
app.get("/api/settings/token", (_req, res) => {
  res.json({ token: TOKEN });
});

// Settings UI → local embedding model choice (runs on this server, not OpenRouter)
app.get("/api/settings/embedding-model", (_req, res) => {
  res.json({ model: getEmbeddingModel(), options: MODEL_OPTIONS });
});

app.patch("/api/settings/embedding-model", (req, res) => {
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

// Persona: not extension-facing, so no Bearer auth — same trust boundary as
// /api/inbox above (this server only ever listens on 127.0.0.1).
async function getOrCreateInstelling() {
  const { rows } = await pool.query("SELECT * FROM persona_instelling LIMIT 1");
  if (rows[0]) return rows[0];
  const inserted = await pool.query("INSERT INTO persona_instelling DEFAULT VALUES RETURNING *");
  return inserted.rows[0];
}

// Promotion rule (mirrors SongCompanion's Maker Memory, hoofdstuk 65): a kenmerk
// only counts as load-bearing once it has >= promotie_min_bronnen unique source
// objects, or 1 + an explicit user confirmation. `confirmed` is permanent and
// authoritative — automatic reinforcement after confirmation must never walk
// zekerheid back down, it only ever adds more bron_object_ids.
//
// A "feit" is stated once and is simply true — it skips the bronnen-ratio math
// entirely (zekerheid 100 immediately) and never auto-promotes to "hypothesis",
// since that status implies forming-but-not-yet-certain, which doesn't apply to
// a declared fact. Only "patroon" goes through the bronnen-based build-up.
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

app.get("/api/persona/instelling", async (_req, res) => {
  res.json(await getOrCreateInstelling());
});

app.patch("/api/persona/instelling", async (req, res) => {
  const current = await getOrCreateInstelling();
  const confidenceThreshold = req.body?.confidenceThreshold ?? current.confidence_threshold;
  const promotieMinBronnen = req.body?.promotieMinBronnen ?? current.promotie_min_bronnen;
  const { rows } = await pool.query(
    `UPDATE persona_instelling SET confidence_threshold = $1, promotie_min_bronnen = $2, updated_at = now()
     WHERE id = $3 RETURNING *`,
    [confidenceThreshold, promotieMinBronnen, current.id]
  );
  res.json(rows[0]);
});

// Excludes rejected kenmerken by default — same "verworpen verdwijnt uit de
// lijst" behavior as SongCompanion's Maker Memory persona list. ?all=true
// includes them too, for the knowledge graph to draw merge trails
// (vervangen_door edges need both ends of a merge, including the loser).
app.get("/api/persona/kenmerken", async (req, res) => {
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

app.post("/api/persona/kenmerken", async (req, res) => {
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

// Nearest kenmerken by cosine similarity — infra for the planned consolidator
// (dedup/contradiction pass over persona_kenmerk), not called automatically yet.
app.get("/api/persona/kenmerken/:id/vergelijkbaar", async (req, res) => {
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

// Adds a source to an existing kenmerk and re-evaluates zekerheid/status —
// the "an existing kenmerk gets reinforced" half of the promotion rule.
app.patch("/api/persona/kenmerken/:id/versterk", async (req, res) => {
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

app.patch("/api/persona/kenmerken/:id/bevestigen", async (req, res) => {
  const { rows } = await pool.query(
    `UPDATE persona_kenmerk SET status = 'confirmed', zekerheid = 100, laatst_versterkt_op = now()
     WHERE id = $1 RETURNING *`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

app.patch("/api/persona/kenmerken/:id/verwerpen", async (req, res) => {
  const { reden } = req.body || {};
  const { rows } = await pool.query(
    "UPDATE persona_kenmerk SET status = 'rejected', verwerp_reden = $1 WHERE id = $2 RETURNING *",
    [reden || null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

// Consolidator action: :id is the weaker duplicate, winnaarId the survivor.
// The winner is reinforced with the loser's bron_object_ids (same promotion
// math as /versterk); the loser is rejected and points at the winner with the
// reasoning kept — never silently deleted, never silently merged without a trace.
app.patch("/api/persona/kenmerken/:id/samenvoegen", async (req, res) => {
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

// assumption_used log: called whenever a kenmerk above the confidence threshold
// actually influences an AI suggestion, so the influence stays inspectable.
app.post("/api/persona/kenmerken/:id/gebruik", async (req, res) => {
  const { objectId, context } = req.body || {};
  if (!objectId || !context) return res.status(400).json({ error: "objectId and context required" });
  const { rows } = await pool.query(
    "INSERT INTO persona_kenmerk_gebruik (kenmerk_id, gebruikt_in_object_id, context) VALUES ($1, $2, $3) RETURNING *",
    [req.params.id, objectId, context]
  );
  res.status(201).json(rows[0]);
});

async function runAutoHealEmbeddings() {
  console.log("[Auto-Heal] Running background auto-heal loop for missing embeddings...");
  try {
    const { rows } = await pool.query(
      "SELECT id, kenmerk FROM persona_kenmerk WHERE embedding IS NULL LIMIT 10"
    );
    for (const row of rows) {
      console.log(`[Auto-Heal] Auto-healing missing embedding for ID: ${row.id}...`);
      try {
        const vector = await embed(row.kenmerk);
        const embeddingLiteral = `[${vector.join(",")}]`;
        await pool.query(
          "UPDATE persona_kenmerk SET embedding = $1 WHERE id = $2",
          [embeddingLiteral, row.id]
        );
        console.log(`[Auto-Heal] Successfully auto-healed ID: ${row.id}`);
      } catch (err) {
        console.error(`[Auto-Heal] Failed to auto-heal ID ${row.id}:`, err.message);
        break; // Stop loop if embedding fails (model not loaded, offline, etc.)
      }
    }
  } catch (err) {
    console.error("[Auto-Heal] Auto-heal query failed:", err.message);
  }
}

async function consolidateKenmerken() {
  console.log("[Consolidator] Running persona consolidation job...");
  try {
    // Query all non-rejected kenmerken that have embeddings
    const { rows } = await pool.query(
      "SELECT * FROM persona_kenmerk WHERE embedding IS NOT NULL AND status != 'rejected' ORDER BY created_at ASC"
    );
    
    const processedIds = new Set();
    
    for (const current of rows) {
      if (processedIds.has(current.id)) continue;
      
      // Find similar traits (cosine similarity > 0.75)
      const { rows: matches } = await pool.query(
        `SELECT id, kenmerk, status, zekerheid, bron_object_ids, soort, 1 - (embedding <=> $1) AS similarity
         FROM persona_kenmerk
         WHERE id != $2 AND embedding IS NOT NULL AND status != 'rejected' AND (1 - (embedding <=> $1)) > 0.75`,
        [current.embedding, current.id]
      );
      
      if (matches.length > 0) {
        console.log(`[Consolidator] Consolidating duplicates for: "${current.kenmerk}"`);
        let mergedBronObjectIds = [...current.bron_object_ids];
        let highestStatus = current.status;
        let highestZekerheid = current.zekerheid;
        let isFeit = current.soort === "feit";
        
        const statusWeight = { observation: 1, hypothesis: 2, confirmed: 3, rejected: 0 };
        
        for (const match of matches) {
          processedIds.add(match.id);
          
          for (const id of match.bron_object_ids) {
            if (!mergedBronObjectIds.includes(id)) {
              mergedBronObjectIds.push(id);
            }
          }
          
          if (statusWeight[match.status] > statusWeight[highestStatus]) {
            highestStatus = match.status;
          }
          
          if (match.zekerheid > highestZekerheid) {
            highestZekerheid = match.zekerheid;
          }
          
          if (match.soort === "feit") {
            isFeit = true;
          }
          
          // Mark merged trait as rejected
          await pool.query(
            "UPDATE persona_kenmerk SET status = 'rejected' WHERE id = $1",
            [match.id]
          );
        }
        
        if (isFeit) {
          highestZekerheid = 100;
        } else {
          // Recompute certainty/status based on new merged sources list
          const instelling = await getOrCreateInstelling();
          const newZekerheid = Math.min(100, Math.round((100 * mergedBronObjectIds.length) / instelling.promotie_min_bronnen));
          highestZekerheid = Math.max(highestZekerheid, newZekerheid);
          
          if (highestStatus === "observation" && mergedBronObjectIds.length >= instelling.promotie_min_bronnen) {
            highestStatus = "hypothesis";
          }
        }
        
        // Update the consolidated trait
        await pool.query(
          `UPDATE persona_kenmerk 
           SET bron_object_ids = $1, zekerheid = $2, status = $3, laatst_versterkt_op = now()
           WHERE id = $4`,
          [mergedBronObjectIds, highestZekerheid, highestStatus, current.id]
        );
      }
    }
  } catch (err) {
    console.error("[Consolidator] Consolidator failed:", err.message);
  }
}

// Schedule background tasks
setInterval(runAutoHealEmbeddings, 300000); // 5 minutes
setInterval(consolidateKenmerken, 300000);  // 5 minutes

setTimeout(runAutoHealEmbeddings, 10000);  // 10 seconds after startup
setTimeout(consolidateKenmerken, 12000);   // 12 seconds after startup

app.listen(PORT, HOST, () => {
  console.log(`\n  Chronicle local API running at http://${HOST}:${PORT}`);
  console.log(`  Token: ${TOKEN}`);
  console.log(`  (paste this token into the extension popup & the app Settings)\n`);
});
