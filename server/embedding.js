const fs = require("fs");
const path = require("path");

// Qwen3-Embedding-0.6B is the default — same model SongCompanion already
// calibrated (the 0.70 threshold, the "short phrases give a narrow similarity
// band" behavior confirmed again in Chronicle's own bge-m3-vs-qwen3 test).
// BGE-M3 stays available: stronger for long-document/hybrid retrieval, but
// that's not what short kenmerk strings need. Both output 1024 dims, so no
// schema change is needed to switch — but switching does NOT re-embed
// existing rows, so old and new embeddings become incomparable until a
// dedicated re-embed pass runs (same caveat SongCompanion flagged).
const MODELS = {
  "qwen3-embedding-0.6b": { id: "onnx-community/Qwen3-Embedding-0.6B-ONNX", dimensions: 1024 },
  "bge-m3": { id: "Xenova/bge-m3", dimensions: 1024 },
};

const DATA_DIR = path.join(__dirname, "data");
const CONFIG_FILE = path.join(DATA_DIR, "embedding-model.txt");

function readConfiguredModel() {
  try {
    const key = fs.readFileSync(CONFIG_FILE, "utf8").trim();
    if (MODELS[key]) return key;
  } catch {
    /* no config yet, use default */
  }
  return "qwen3-embedding-0.6b";
}

let currentModelKey = readConfiguredModel();
let pipelinePromise = null;
let loadedModelKey = null;

async function getPipeline() {
  if (!pipelinePromise || loadedModelKey !== currentModelKey) {
    loadedModelKey = currentModelKey;
    pipelinePromise = import("@huggingface/transformers").then(({ pipeline, env }) => {
      env.localModelPath = path.join(__dirname, "models");
      return pipeline("feature-extraction", MODELS[currentModelKey].id, { dtype: "q8" });
    });
  }
  return pipelinePromise;
}

async function embed(text) {
  const extractor = await getPipeline();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

function getModel() {
  return currentModelKey;
}

function setModel(key) {
  if (!MODELS[key]) throw new Error("unknown embedding model");
  currentModelKey = key;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, key);
}

module.exports = { embed, getModel, setModel, MODEL_OPTIONS: Object.keys(MODELS) };
