/**
 * Connector registry — generic over specific (Chronicle §1).
 * Each connector type registers a name, validate(), test(), and sync().
 * The router calls these methods; no route handler knows WordPress specifics.
 *
 * Config is stored in a simple JSON file (server/data/connectors.json),
 * same file-based persistence as the inbox pipeline.
 */

const path = require("path");
const fs = require("fs");
const { pushToInbox } = require("../inboxStore");

const STORE_PATH = path.join(__dirname, "..", "data", "connectors.json");

/* ------------------------------------------------------------------- */
/*  Persistence (private to this module)                                */
/* ------------------------------------------------------------------- */

function readStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return [];
    const raw = fs.readFileSync(STORE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeStore(connectors) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(connectors, null, 2), "utf-8");
}

/* ------------------------------------------------------------------- */
/*  Connector registry                                                  */
/* ------------------------------------------------------------------- */

const registry = new Map();

/**
 * Register a connector type.  `impl` must expose:
 *   type          — string, e.g. "wordpress"
 *   label         — human-readable, e.g. "WordPress"
 *   validate(config)  — throw if config is invalid
 *   test(config)      — return { ok: bool, error?: string }
 *   sync(config)      — fetch external data, return { posts: [...], error? }
 */
function register(impl) {
  if (!impl.type) throw new Error("Connector must have a .type");
  registry.set(impl.type, impl);
}

/* -- CRUD helpers that delegates validation to the registered type -- */

function listConnectors() {
  return readStore();
}

function getConnector(id) {
  return readStore().find((c) => c.id === id) || null;
}

function createConnector({ type, label, config }) {
  const impl = registry.get(type);
  if (!impl) throw new Error(`Unknown connector type: "${type}"`);

  impl.validate(config);

  const store = readStore();
  const id = "conn_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  const entry = { id, type, label, config, status: "disconnected", lastSyncAt: null, createdAt: new Date().toISOString() };
  store.push(entry);
  writeStore(store);
  return entry;
}

function updateConnector(id, patch) {
  const store = readStore();
  const idx = store.findIndex((c) => c.id === id);
  if (idx === -1) return null;

  const entry = store[idx];
  const typeImpl = registry.get(entry.type);

  // Validate config if provided
  if (patch.config && typeImpl) typeImpl.validate(patch.config);

  Object.assign(entry, patch, { id: entry.id }); // id is immutable
  writeStore(store);
  return entry;
}

function deleteConnector(id) {
  const store = readStore();
  const idx = store.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  store.splice(idx, 1);
  writeStore(store);
  return true;
}

async function testConnector(id) {
  const entry = getConnector(id);
  if (!entry) throw new Error("Connector not found");
  const typeImpl = registry.get(entry.type);
  if (!typeImpl || !typeImpl.test) throw new Error(`Type "${entry.type}" does not support testing`);

  const result = await typeImpl.test(entry.config);

  // Update status based on test result
  const store = readStore();
  const idx = store.findIndex((c) => c.id === id);
  if (idx !== -1) {
    store[idx].status = result.ok ? "connected" : "error";
    writeStore(store);
  }

  return result;
}

async function syncConnector(id) {
  const entry = getConnector(id);
  if (!entry) throw new Error("Connector not found");
  const typeImpl = registry.get(entry.type);
  if (!typeImpl || !typeImpl.sync) throw new Error(`Type "${entry.type}" does not support syncing`);

  const result = await typeImpl.sync(entry.config);

  // Push each synced item straight into the same inbox every other capture
  // source uses (extension, bulk import, native activity capture) — the
  // existing pollInbox() distribution step turns it into a Chronicle object
  // with no special-cased frontend handling needed. Previously the frontend
  // just discarded result.posts after showing a count — nothing was ever
  // actually persisted.
  if (result.ok && Array.isArray(result.posts)) {
    for (const post of result.posts) {
      pushToInbox({
        type: "note",
        title: post.title || "Untitled",
        content: post.content || post.excerpt || "",
        sourceProvider: entry.type,
        url: post.url || null,
        // WP's tags/categories here are numeric taxonomy ids, not resolved
        // labels — not useful as Chronicle tags without an extra lookup, so
        // left empty for now rather than showing raw numbers.
        tags: [],
        occurredAt: post.date || null,
        source: "connector",
        queuedAt: new Date().toISOString(),
      });
    }
  }

  // Update lastSyncAt and status
  const store = readStore();
  const idx = store.findIndex((c) => c.id === id);
  if (idx !== -1) {
    store[idx].lastSyncAt = new Date().toISOString();
    store[idx].status = result.error ? "error" : "connected";
    writeStore(store);
  }

  return { ...result, connectorId: id };
}

module.exports = {
  register,
  listConnectors,
  getConnector,
  createConnector,
  updateConnector,
  deleteConnector,
  testConnector,
  syncConnector,
};
