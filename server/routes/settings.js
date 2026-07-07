const express = require("express");
const { TOKEN } = require("../auth");
const { getModel: getEmbeddingModel, setModel: setEmbeddingModel, MODEL_OPTIONS } = require("../embedding");
const { reembedAllRows } = require("../reembed");

const router = express.Router();

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

module.exports = router;
