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

// Fields a locked object refuses to change — the user's actual information.
// Bookkeeping fields (processedAt, updatedAt, embedding-related, etc.) are
// deliberately NOT in this list: pipelines like persona consolidation still
// need to mark a locked object as "seen" without that counting as altering it.
const LOCKED_PROTECTED_FIELDS = [
  "title", "content", "turns", "tags", "type", "source", "sourceProvider", "sourceUrl",
  "occurredAt", "validFrom", "validTo", "temporalText", "links",
];

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
  async findByProviderConversationId(_id) { throw new Error("not implemented"); }
  async mergeAll(_objects) { throw new Error("not implemented"); }
  async replaceAll(_objects) { throw new Error("not implemented"); }
}

export class IndexedDBObjectRepository extends ObjectRepository {
  _validateImported(objects) {
    if (!Array.isArray(objects)) throw new Error("Imported objects must be an array");
    const ids = new Set();
    return objects.map((object) => {
      if (!object || typeof object.id !== "string" || !object.id || ids.has(object.id)) {
        throw new Error(`Invalid or duplicate object id: ${object?.id || "unknown"}`);
      }
      ids.add(object.id);
      return {
        ...object,
        type: validateType(object.type),
        tags: Array.isArray(object.tags) ? object.tags : [],
        turns: Array.isArray(object.turns) ? object.turns : [],
        attachments: Array.isArray(object.attachments) ? object.attachments : [],
        links: Array.isArray(object.links) ? object.links : [],
      };
    });
  }

  async mergeAll(objects) {
    const validated = this._validateImported(objects);
    const db = await getDB();
    const tx = db.transaction(OBJECT_STORE, "readwrite");
    for (const object of validated) await tx.store.put(object);
    await tx.done;
    return validated.length;
  }

  async replaceAll(objects) {
    const validated = this._validateImported(objects);
    const db = await getDB();
    const tx = db.transaction(OBJECT_STORE, "readwrite");
    await tx.store.clear();
    for (const object of validated) await tx.store.put(object);
    await tx.done;
    return validated.length;
  }

  async create(data = {}) {
    const now = new Date().toISOString();
    const obj = {
      id: data.id || uid(),
      type: validateType(data.type),
      title: data.title != null ? data.title : "",
      content: data.content || "",
      contentHash: data.contentHash || (data.content ? contentHash(data.content) : ""),
      tags: Array.isArray(data.tags) ? data.tags : [],
      // Structured { role, text } turns, persisted so chat objects can be
      // rendered as real chat bubbles from the actual data instead of
      // pattern-matching "H: "/"A: " prefixes in the flattened `content`
      // string — that convention breaks for a turn starting with a heading/
      // code fence/list, and can false-positive on an ordinary note whose
      // text happens to start with "A: ". Empty for object types that were
      // never a chat, and for chat objects imported before this field existed.
      turns: Array.isArray(data.turns) ? data.turns : [],
      // Metadata only ({id, filename, mimeType, size, url} per item) — the
      // actual bytes live on the local server (server/data/attachments/),
      // never in IndexedDB, to keep large binaries out of browser storage.
      attachments: Array.isArray(data.attachments) ? data.attachments : [],
      source: data.source || "manual",
      sourceProvider: data.sourceProvider || null,
      sourceUrl: data.sourceUrl || null,
      // Stable identity for the conversation this object came from — see
      // lib/providerConversationId.js. Lets pollInbox() recognize "this is
      // the same chat, re-imported" (via extension + bulk importer, or a
      // re-run after the chat grew) and update the existing object instead
      // of creating a duplicate, which contentHash alone can't do since it
      // changes whenever the conversation's content changes.
      providerConversationId: data.providerConversationId || null,
      links: Array.isArray(data.links) ? data.links : [],
      occurredAt: data.occurredAt || null,
      validFrom: data.validFrom || null,
      validTo: data.validTo || null,
      temporalText: data.temporalText || null,
      // Generic "when was this last processed" watermark — not scoped to any
      // one pipeline. Compared against updatedAt by any process that wants
      // to skip re-processing unchanged content (currently: persona
      // detection's full scan).
      processedAt: data.processedAt || null,
      locked: data.locked === true,
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
    if (filter.type === "all") {
      // "Everything" — the general browsing view. Activity objects are
      // passive, AI-collected context (app-switch/window-focus captures
      // from the UIA pipeline), not content the user authored, so they get
      // their own dedicated "Activity" nav item instead of cluttering this
      // list alongside notes/chats/etc. A bare list() (no `type` at all —
      // used for object-lookup/relation purposes, not this view) still
      // returns everything, since e.g. selecting an activity object via its
      // own nav item needs to be able to find it.
      all = all.filter((o) => o.type !== "activity");
    } else if (filter.type && filter.type !== "all") {
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
    if (existing.locked && LOCKED_PROTECTED_FIELDS.some((f) => f in patch)) {
      throw new Error("This entry is locked. Unlock it before making changes.");
    }
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
    const existing = await db.get(OBJECT_STORE, id);
    if (existing?.locked) {
      throw new Error("This entry is locked. Unlock it before deleting it.");
    }
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
    const byId = new Map(all.map((object) => [object.id, object]));
    const scored = all
      .map((o) => {
        const title = (o.title || "").toLowerCase();
        const tags = (o.tags || []).join(" ").toLowerCase();
        const temporal = (o.temporalText || "").toLowerCase();
        const linkedTitles = (o.links || [])
          .map((id) => byId.get(id)?.title || "")
          .join(" ")
          .toLowerCase();
        const hay = [title, (o.content || "").toLowerCase(), tags, (o.sourceProvider || "").toLowerCase(), temporal, linkedTitles].join(" ");
        let score = 0;
        if (title.includes(q)) score += 5;
        if (tags.includes(q)) score += 3;
        if (temporal.includes(q)) score += 2;
        if (linkedTitles.includes(q)) score += 2;
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
    // "all" mirrors what the "Everything" view actually shows (see list()) —
    // activity objects are still tallied under their own `activity` key so
    // the dedicated nav item's badge stays correct, just not folded into
    // the general total.
    const counts = { all: 0, untyped: 0 };
    for (const o of all) {
      if (!o.type || !valid.has(o.type)) counts.untyped += 1;
      else counts[o.type] = (counts[o.type] || 0) + 1;
      if (o.type !== "activity") counts.all += 1;
    }
    return counts;
  }

  async findByContentHash(hash) {
    if (!hash) return null;
    const db = await getDB();
    const all = await db.getAll(OBJECT_STORE);
    return all.find((o) => o.contentHash === hash) || null;
  }

  async findByProviderConversationId(providerConversationId) {
    if (!providerConversationId) return null;
    const db = await getDB();
    const all = await db.getAll(OBJECT_STORE);
    return all.find((o) => o.providerConversationId === providerConversationId) || null;
  }
}
