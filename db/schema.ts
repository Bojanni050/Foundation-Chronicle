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

// Same StatusMarkering-inspired trust vocabulary as SongCompanion's intentie_element/
// maker_memory — a persona kenmerk starts as an unconfirmed observation and only
// becomes load-bearing once promoted, never silently treated as fact from one signal.
export const statusMarkeringEnum = pgEnum("status_markering", [
  "observation",
  "hypothesis",
  "confirmed",
  "rejected",
]);

// A "feit" is stated once and is simply true (e.g. "ogen zijn bruin") — it
// never needs the bronnen-promotion math. A "patroon" is inferred from
// repeated behavior (e.g. "schrijft graag 's avonds") and only becomes
// load-bearing once it recurs across independent sources.
export const soortKenmerkEnum = pgEnum("soort_kenmerk", ["feit", "patroon"]);

// Cross-object memory layer, analogous to SongCompanion's maker_memory. Lives
// outside the IndexedDB ObjectRepository contract on purpose: a persona kenmerk
// is not itself an "object" of the app, it's inferred context about the user.
export const personaKenmerk = pgTable("persona_kenmerk", {
  id: uuid("id").primaryKey().defaultRandom(),
  kenmerk: text("kenmerk").notNull(),
  soort: soortKenmerkEnum("soort").notNull().default("patroon"),
  // Personality-judgment-style patronen (e.g. "ongeduldig") — never counted as
  // usable just because zekerheid crossed the threshold; always needs explicit
  // confirmation first, regardless of how many sources support it.
  gevoelig: boolean("gevoelig").notNull().default(false),
  // 0-100, same scale as maker_memory.zekerheid — makes the confidence-threshold
  // promotion logic possible. Always 100 for soort "feit".
  zekerheid: integer("zekerheid").notNull().default(0),
  status: statusMarkeringEnum("status").notNull().default("observation"),
  // Chronicle object ids are app-generated strings ("obj_<ts>_<rand>"), not UUIDs.
  bronObjectIds: text("bron_object_ids").array().notNull().default([]),
  // Local Qwen3-Embedding-0.6B (server/embedding.js), 1024 dims — same model
  // and dimension SongCompanion settled on. Nullable: a kenmerk still saves
  // even if local embedding generation fails (model not downloaded yet, etc.),
  // same graceful-fallback philosophy as the rest of Chronicle's AI features.
  embedding: vector("embedding", { dimensions: 1024 }),
  // Merge trail — same pattern as SongCompanion's intentie_element.vervangenDoor/
  // herzieningsreden (Architecture Document 03, hfst. 62): a kenmerk rejected
  // because the consolidator merged it into a better-evidenced duplicate is
  // never deleted, only pointed at the survivor, with the reasoning kept so
  // the "why" of a consolidation stays inspectable instead of silent.
  vervangenDoor: uuid("vervangen_door"),
  verwerpReden: text("verwerp_reden"),
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
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// assumption_used log: every time an above-threshold kenmerk actually influences
// an AI suggestion (AI Weave, AI Pulse, auto-tagging, ...), it's recorded here
// so the influence stays inspectable instead of silent.
export const personaKenmerkGebruik = pgTable("persona_kenmerk_gebruik", {
  id: uuid("id").primaryKey().defaultRandom(),
  kenmerkId: uuid("kenmerk_id")
    .notNull()
    .references(() => personaKenmerk.id, { onDelete: "cascade" }),
  gebruiktInObjectId: text("gebruikt_in_object_id").notNull(),
  context: text("context").notNull(),
  gebruiktOp: timestamp("gebruikt_op", { withTimezone: true }).notNull().defaultNow(),
});
