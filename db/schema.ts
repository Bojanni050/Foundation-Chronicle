import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

// Chronicle Manifest V6 §5. "interpretation" sits between raw observation and
// hypothesis (Chronicle's own first analytical structuring of an observation,
// before it's repeated enough to become a hypothesis) — not yet wired into
// any pipeline, added for forward compatibility per the manifest's five-value
// vocabulary; existing code only ever produces observation/hypothesis/
// confirmed/rejected today.
export const statusMarkeringEnum = pgEnum("status_markering", [
  "observation",
  "interpretation",
  "hypothesis",
  "confirmed",
  "rejected",
]);

// Manifest §5: a rejected record's re-eligibility depends fundamentally on
// *why* it was rejected — a consolidatie-rejectie is permanently absorbed
// into its survivor (vervangen_door) and must never resurrect on its own;
// a mens-rejectie is a rejected conclusion, not rejected evidence, and can
// be revisited given a genuinely new source (see voorganger_id below).
export const verwerpBronEnum = pgEnum("verwerp_bron", ["consolidatie", "mens"]);

// A "feit" is stated once and is simply true (e.g. "ogen zijn bruin") — it
// never needs the bronnen-promotion math. A "patroon" is inferred from
// repeated behavior (e.g. "schrijft graag 's avonds") and only becomes
// load-bearing once it recurs across independent sources. Only meaningful
// for categorie "persona" — left unset for "skill"/"algemeen".
export const soortKenmerkEnum = pgEnum("soort_kenmerk", ["feit", "patroon"]);

// persona / skill / algemeen are not three separate things — they're three
// categories of the same underlying concept (a piece of extracted knowledge,
// evidenced by objects, moving through the same observation→hypothesis→
// confirmed→rejected ladder). "persona" = a claim about the owner. "skill" =
// a reusable procedure/workflow picked up on. "algemeen" = a fact or
// concept from content that isn't about the owner at all. Consolidation and
// resurrection only ever compare within the same categorie — a persona trait
// never merges with a general fact just because the text happens to overlap.
export const categorieEnum = pgEnum("categorie", ["persona", "skill", "algemeen"]);

// Cross-object memory layer, analogous to SongCompanion's maker_memory. Lives
// outside the IndexedDB ObjectRepository contract on purpose: a kennis-item
// is not itself an "object" of the app, it's inferred context extracted from
// objects.
//
// NOTE: exported as `kennis` (the corrected mental model — persona/skill/
// algemeen are categories of one thing, not three things), but the physical
// SQL table name stays "persona_kenmerk" — renaming the physical table
// requires drizzle-kit's interactive rename-resolution prompt, which needs a
// real TTY this environment doesn't have. The JS/TS name is what the rest of
// the codebase should read as truth; the SQL name is a historical artifact.
export const kennis = pgTable("persona_kenmerk", {
  id: uuid("id").primaryKey().defaultRandom(),
  categorie: categorieEnum("categorie").notNull().default("persona"),
  kenmerk: text("kenmerk").notNull(),
  // Only meaningful for categorie "persona" — null for "skill"/"algemeen".
  soort: soortKenmerkEnum("soort"),
  // Personality-judgment-style patronen (e.g. "ongeduldig") — never counted as
  // usable just because zekerheid crossed the threshold; always needs explicit
  // confirmation first, regardless of how many sources support it. Only
  // meaningful for categorie "persona".
  gevoelig: boolean("gevoelig").notNull().default(false),
  // 0-100, same scale as maker_memory.zekerheid — makes the confidence-threshold
  // promotion logic possible. Always 100 for soort "feit" and for "algemeen"
  // (a fact doesn't get truer by repetition, so it starts fully-weighted —
  // still subject to rejection, just not to the bronnen-count ladder).
  zekerheid: integer("zekerheid").notNull().default(0),
  status: statusMarkeringEnum("status").notNull().default("observation"),
  // Chronicle object ids are app-generated strings ("obj_<ts>_<rand>"), not UUIDs.
  bronObjectIds: text("bron_object_ids").array().notNull().default([]),
  // Local Qwen3-Embedding-0.6B (server/embedding.js), 1024 dims — same model
  // and dimension SongCompanion settled on. Nullable: a kennis-item still saves
  // even if local embedding generation fails (model not downloaded yet, etc.),
  // same graceful-fallback philosophy as the rest of Chronicle's AI features.
  embedding: vector("embedding", { dimensions: 1024 }),
  // Merge trail — same pattern as SongCompanion's intentie_element.vervangenDoor/
  // herzieningsreden (Architecture Document 03, hfst. 62): a kennis-item rejected
  // because the consolidator merged it into a better-evidenced duplicate is
  // never deleted, only pointed at the survivor, with the reasoning kept so
  // the "why" of a consolidation stays inspectable instead of silent.
  vervangenDoor: uuid("vervangen_door"),
  verwerpReden: text("verwerp_reden"),
  // Categorisch onderscheid (Manifest §5) — nullable, alleen gezet als status = 'rejected'.
  verwerpBron: verwerpBronEnum("verwerp_bron"),
  // Zelf-referentie naar het mens-verworpen record waaruit dit record is
  // heropstaan met nieuw bewijs. Alleen gezet bij heropstanding, nooit bij
  // een gewone eerste observatie.
  voorgangerId: uuid("voorganger_id"),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validTo: timestamp("valid_to", { withTimezone: true }),
  temporalText: text("temporal_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  laatstVersterktOp: timestamp("laatst_versterkt_op", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Singleton settings row, same pattern as SongCompanion's maker_memory_instelling
// (uuid id, singleton enforced at the application level, not a DB constraint).
export const personaInstelling = pgTable("persona_instelling", {
  id: uuid("id").primaryKey().defaultRandom(),
  confidenceThreshold: integer("confidence_threshold").notNull().default(90),
  promotieMinBronnen: integer("promotie_min_bronnen").notNull().default(2),
  // Disposition traits (1-5, default 3 = neutral) — same three-trait concept
  // Hindsight's Reflect uses to shape how a bank interprets information,
  // rebuilt here rather than depending on their service. Feed into detection
  // and Pulse prompts, not into the promotion math itself.
  skepticism: integer("skepticism").notNull().default(3),
  literalism: integer("literalism").notNull().default(3),
  empathy: integer("empathy").notNull().default(3),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// "Mental model" cache (Hindsight-inspired, rebuilt locally): the last AI
// Pulse result, shown instantly on open instead of regenerating every time.
// Singleton — Pulse has exactly one current digest, not a history.
export const personaPulseCache = pgTable("persona_pulse_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  items: text("items").array().notNull(),
  aiUsed: boolean("ai_used").notNull().default(false),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

// assumption_used log: every time an above-threshold kennis-item actually
// influences an AI suggestion (AI Weave, AI Pulse, auto-tagging, ...), it's
// recorded here so the influence stays inspectable instead of silent.
export const kennisGebruik = pgTable("persona_kenmerk_gebruik", {
  id: uuid("id").primaryKey().defaultRandom(),
  kenmerkId: uuid("kenmerk_id")
    .notNull()
    .references(() => kennis.id, { onDelete: "cascade" }),
  gebruiktInObjectId: text("gebruikt_in_object_id").notNull(),
  context: text("context").notNull(),
  gebruiktOp: timestamp("gebruikt_op", { withTimezone: true }).notNull().defaultNow(),
});

// --------------------------------------------------------------------------
// Generic content-search layer — same local Qwen3-Embedding-0.6B (1024 dims)
// as persona_kenmerk. Two granularities on purpose: a chunk-level hit tells
// you "this specific part", an object-level hit tells you "this whole
// object" — different questions, both useful. Deliberately generic (not
// chat-specific): a chat object's chunks happen to be one per turn, but a
// long note could just as well be split into paragraph-sized chunks later
// with the same mechanism. objectId is plain text (Chronicle's
// app-generated "obj_<ts>_<rand>" ids from IndexedDB) — no FK, since objects
// live in IndexedDB, not Postgres.
//
// No role/type column here on purpose: which part of an object a chunk
// represents (e.g. "assistant turn" for a chat) is a parsing-time detail,
// baked into the chunk's own content (e.g. "Assistant: ...") rather than a
// column that would only make sense for one object type.
// --------------------------------------------------------------------------

// One chunk of an object's content. embedding is nullable — same
// graceful-fallback philosophy as persona_kenmerk: a chunk still saves even
// if local embedding generation fails.
export const objectChunk = pgTable("object_chunk", {
  id: uuid("id").primaryKey().defaultRandom(),
  objectId: text("object_id").notNull(),
  content: text("content").notNull(),
  orderIndex: integer("order_index").notNull(),
  embedding: vector("embedding", { dimensions: 1024 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per object — a single embedding over the whole object (title +
// full content), for "find that one object about X" style search.
export const objectEmbedding = pgTable("object_embedding", {
  objectId: text("object_id").primaryKey(),
  embedding: vector("embedding", { dimensions: 1024 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --------------------------------------------------------------------------
// Epistemic memory — a general hypothesis/evidence/knowledge-gap layer,
// distinct from persona_kenmerk. persona_kenmerk answers "what pattern does
// this evidence support, about the owner specifically, weighed by a single
// bronnen-count"; hypothesis/evidence answers a broader question that isn't
// owner-specific and isn't reducible to a source count: "what does this
// specific piece of evidence say, in which direction, and where exactly did
// it come from" — provenance and directionality are first-class here, not
// flattened into a bron_object_ids array.
//
// Same non-negotiable as persona_kenmerk (Manifest §5): nothing here ever
// auto-promotes. Meeting verification criteria only ever changes what
// isVerified() in epistemicPolicy.js reports — never the stored status.
// Only an explicit confirm/reject call (a human decision) writes status.
// --------------------------------------------------------------------------

export const hypothesisStatusEnum = pgEnum("hypothesis_status", [
  "open",
  "confirmed",
  "rejected",
]);

// supporting = argues for the hypothesis. contradicting = argues against it.
// contextualizing = neither — background that shapes interpretation without
// itself arguing a side (e.g. "asked in jest", "quoting someone else").
export const evidenceDirectionEnum = pgEnum("evidence_direction", [
  "supporting",
  "contradicting",
  "contextualizing",
]);

// A knowledge gap's own small lifecycle, independent of any one hypothesis.
// unknown = never looked into. not_asked = identified but no source has
// addressed it yet. known_absent = actively looked, genuinely no answer
// exists in the sources checked (a real finding, not silence). resolved =
// answered, normally via a linked hypothesis reaching "confirmed".
export const knowledgeGapStatusEnum = pgEnum("knowledge_gap_status", [
  "unknown",
  "not_asked",
  "known_absent",
  "resolved",
]);

export const hypothesis = pgTable("hypothesis", {
  id: uuid("id").primaryKey().defaultRandom(),
  hypothese: text("hypothese").notNull(),
  // What would count as verified/confirmed/rejected — written once at
  // creation so a later confirm/reject is judged against a fixed bar the
  // hypothesis itself declared, not a bar invented after the fact.
  verificatieCriteria: text("verificatie_criteria"),
  bevestigingsCriteria: text("bevestigings_criteria"),
  afwijzingsCriteria: text("afwijzings_criteria"),
  status: hypothesisStatusEnum("status").notNull().default("open"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  verwerpReden: text("verwerp_reden"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const evidence = pgTable("evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  hypothesisId: uuid("hypothesis_id")
    .notNull()
    .references(() => hypothesis.id, { onDelete: "cascade" }),
  richting: evidenceDirectionEnum("richting").notNull(),
  // What kind of source this is (e.g. "chat", "note", "document") — free
  // text, not an enum: Chronicle's object types already grow via
  // AddTypeDialog, a closed enum here would need a migration every time.
  bronsoort: text("bronsoort").notNull(),
  fragment: text("fragment").notNull(),
  // Who said it, if known (e.g. a turn's role, or a named person) — nullable
  // since not every source has an identifiable speaker (e.g. a document).
  spreker: text("spreker"),
  // When the *source content* occurred (e.g. a chat turn's own timestamp),
  // not when this evidence row was recorded — createdAt below covers that.
  tijdstip: timestamp("tijdstip", { withTimezone: true }),
  // Chronicle object id (app-generated string, no FK — same convention as
  // persona_kenmerk.bron_object_ids: objects live in IndexedDB, not Postgres).
  bronObjectId: text("bron_object_id").notNull(),
  // Precise pointer within the source object (e.g. a turn index or URL
  // fragment) for re-finding the exact spot the fragment came from.
  bronReferentie: text("bron_referentie"),
  // The provider-conversation-identity string (e.g. "chatgpt:<uuid>"), when
  // the source is a chat — this is what epistemicPolicy's independence
  // check groups on: two evidence rows from the same conversation are one
  // source, not two, no matter how many separate turns they're pulled from.
  // Null for non-chat sources, where bronObjectId itself is the source unit.
  conversationIdentity: text("conversation_identity"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const knowledgeGap = pgTable("knowledge_gap", {
  id: uuid("id").primaryKey().defaultRandom(),
  onderwerp: text("onderwerp").notNull(),
  status: knowledgeGapStatusEnum("status").notNull().default("unknown"),
  // The hypothesis expected to resolve this gap, if one exists yet — optional,
  // a gap can be identified before any hypothesis addressing it has been formed.
  hypothesisId: uuid("hypothesis_id").references(() => hypothesis.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

