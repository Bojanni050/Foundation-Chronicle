import { getDB, OBJECT_STORE } from "@/lib/db";
import { getValidTypeKeys } from "@/lib/typeRegistry";
import { contentHash } from "@/lib/contentHash";

function uid() {
  return (
    "obj_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}

function fuzzyMatch(query, text) {
  let qi = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) qi++;
  }
  return qi === query.length;
}

// Type is OPTIONAL: an item may be saved without a type (stored as null).
// But IF a type is provided, it must be a known built-in or custom type.
function validateType(type) {
  if (type === undefined || type === null || type === "") return null;
  if (!getValidTypeKeys().has(type)) {
    throw new Error(`Invalid object type: "${type}"`);
  }
  return type;
}

/**
 * Abstract repository contract. Any backend (IndexedDB now, a local
 * PostgreSQL-backed API later) must implement these methods with the same
 * shapes. UI code depends ONLY on this contract, never on the implementation.
 */
export class ObjectRepository {
  async create(_data) { throw new Error("not implemented"); }
  async getById(_id) { throw new Error("not implemented"); }
  async list(_filter) { throw new Error("not implemented"); }
  async update(_id, _patch) { throw new Error("not implemented"); }
  async delete(_id) { throw new Error("not implemented"); }
  async search(_query) { throw new Error("not implemented"); }
  async counts() { throw new Error("not implemented"); }
  async findByContentHash(_hash) { throw new Error("not implemented"); }
}

export class IndexedDBObjectRepository extends ObjectRepository {
  async create(data = {}) {
    const now = new Date().toISOString();
    const obj = {
      id: data.id || uid(),
      type: validateType(data.type),
      title: data.title != null ? data.title : "",
      content: data.content || "",
      contentHash: data.contentHash || (data.content ? contentHash(data.content) : ""),
      tags: Array.isArray(data.tags) ? data.tags : [],
      source: data.source || "manual",
      sourceProvider: data.sourceProvider || null,
      sourceUrl: data.sourceUrl || null,
      links: Array.isArray(data.links) ? data.links : [],
      occurredAt: data.occurredAt || null,
      validFrom: data.validFrom || null,
      validTo: data.validTo || null,
      temporalText: data.temporalText || null,
      lastProcessedForPersonaAt: data.lastProcessedForPersonaAt || null,
      createdAt: data.createdAt || now,
      updatedAt: now,
    };
    const db = await getDB();
    await db.put(OBJECT_STORE, obj);
    return obj;
  }

  async getById(id) {
    const db = await getDB();
    return (await db.get(OBJECT_STORE, id)) || null;
  }

  async list(filter = {}) {
    const db = await getDB();
    let all = await db.getAll(OBJECT_STORE);
    if (filter.type && filter.type !== "all") {
      if (filter.type === "untyped") {
        const valid = getValidTypeKeys();
        all = all.filter((o) => !o.type || !valid.has(o.type));
      } else {
        all = all.filter((o) => o.type === filter.type);
      }
    }
    all.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    return all;
  }

  async update(id, patch = {}) {
    const db = await getDB();
    const existing = await db.get(OBJECT_STORE, id);
    if (!existing) return null;
    const cleanPatch = { ...patch };
    if ("type" in cleanPatch) cleanPatch.type = validateType(cleanPatch.type);
    const updated = {
      ...existing,
      ...cleanPatch,
      id,
      createdAt: existing.createdAt,
      updatedAt: patch.updatedAt !== undefined ? patch.updatedAt : new Date().toISOString(),
    };
    await db.put(OBJECT_STORE, updated);
    return updated;
  }

  async delete(id) {
    const db = await getDB();
    await db.delete(OBJECT_STORE, id);
    return true;
  }

  async search(query) {
    const db = await getDB();
    const all = await db.getAll(OBJECT_STORE);
    if (!query || !query.trim()) {
      return all.sort((a, b) =>
        (b.updatedAt || "").localeCompare(a.updatedAt || "")
      );
    }
    const q = query.toLowerCase().trim();
    const scored = all
      .map((o) => {
        const title = (o.title || "").toLowerCase();
        const tags = (o.tags || []).join(" ").toLowerCase();
        const temporal = (o.temporalText || "").toLowerCase();
        const hay = [title, (o.content || "").toLowerCase(), tags, (o.sourceProvider || "").toLowerCase(), temporal].join(" ");
        let score = 0;
        if (title.includes(q)) score += 5;
        if (tags.includes(q)) score += 3;
        if (temporal.includes(q)) score += 2;
        if (hay.includes(q)) score += 1;
        if (score === 0 && fuzzyMatch(q, hay)) score += 0.5;
        return { o, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.map((x) => x.o);
  }

  async counts() {
    const all = await this.list();
    const valid = getValidTypeKeys();
    const counts = { all: all.length, untyped: 0 };
    for (const o of all) {
      if (!o.type || !valid.has(o.type)) counts.untyped += 1;
      else counts[o.type] = (counts[o.type] || 0) + 1;
    }
    return counts;
  }

  async findByContentHash(hash) {
    if (!hash) return null;
    const db = await getDB();
    const all = await db.getAll(OBJECT_STORE);
    return all.find((o) => o.contentHash === hash) || null;
  }
}