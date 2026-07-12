import { getSettings } from "@/lib/settings";
import { objectRepository } from "@/repositories";
import { AIService } from "@/services/AIService";

async function fetchKenmerken(apiUrl) {
  const res = await fetch(`${apiUrl}/api/persona/kenmerken`);
  if (!res.ok) throw new Error("PERSONA_API_ERROR");
  return res.json();
}

async function fetchRejectedKenmerken(apiUrl) {
  const res = await fetch(`${apiUrl}/api/persona/kenmerken?status=rejected`);
  if (!res.ok) throw new Error("PERSONA_API_ERROR");
  return res.json();
}

/** Includes rejected/merged-away kenmerken — for the knowledge graph, which
 * draws vervangen_door edges that need both ends of a merge. */
export async function fetchAlleKenmerken() {
  const { apiUrl } = getSettings();
  if (!apiUrl) return [];
  try {
    const res = await fetch(`${apiUrl}/api/persona/kenmerken?all=true`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function createKenmerk(apiUrl, kenmerk, bronObjectId, soort, gevoelig) {
  const res = await fetch(`${apiUrl}/api/persona/kenmerken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kenmerk, bronObjectId, soort, gevoelig }),
  });
  if (!res.ok) throw new Error("PERSONA_API_ERROR");
  return res.json();
}

/**
 * A "categorie: algemeen" candidate is a fact/concept from content, not a
 * claim about the owner — it doesn't need persona_kenmerk's trust ladder,
 * just a plain, searchable "kennis" object, linked back to its source via
 * the same `links` field ObjectDetail already shows.
 */
export async function createKennisObject(kenmerk, bronObjectId) {
  return objectRepository.create({
    type: "note",
    title: kenmerk.length > 80 ? kenmerk.slice(0, 77) + "..." : kenmerk,
    content: kenmerk,
    tags: ["ai-extracted"],
    source: "ai",
    links: bronObjectId ? [bronObjectId] : [],
  });
}

async function versterkKenmerk(apiUrl, id, bronObjectId) {
  const res = await fetch(`${apiUrl}/api/persona/kenmerken/${id}/versterk`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bronObjectId }),
  });
  if (!res.ok) throw new Error("PERSONA_API_ERROR");
  return res.json();
}

async function fetchInstelling(apiUrl) {
  const res = await fetch(`${apiUrl}/api/persona/instelling`);
  if (!res.ok) throw new Error("PERSONA_API_ERROR");
  return res.json();
}

/** Current kenmerken + settings for the Persona panel. Null if unreachable. */
export async function getPersonaState() {
  const { apiUrl } = getSettings();
  if (!apiUrl) return null;
  try {
    const [instelling, kenmerken] = await Promise.all([fetchInstelling(apiUrl), fetchKenmerken(apiUrl)]);
    return { instelling, kenmerken };
  } catch {
    return null;
  }
}

export async function bevestigKenmerk(id) {
  const { apiUrl } = getSettings();
  const res = await fetch(`${apiUrl}/api/persona/kenmerken/${id}/bevestigen`, { method: "PATCH" });
  if (!res.ok) throw new Error("PERSONA_API_ERROR");
  return res.json();
}

export async function verwerpKenmerk(id) {
  const { apiUrl } = getSettings();
  const res = await fetch(`${apiUrl}/api/persona/kenmerken/${id}/verwerpen`, { method: "PATCH" });
  if (!res.ok) throw new Error("PERSONA_API_ERROR");
  return res.json();
}

/** Cached "mental model" of the last Pulse digest — null if never generated. */
export async function getCachedPulse() {
  const { apiUrl } = getSettings();
  if (!apiUrl) return null;
  try {
    const res = await fetch(`${apiUrl}/api/persona/pulse`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function cachePulse(items, aiUsed) {
  const { apiUrl } = getSettings();
  const res = await fetch(`${apiUrl}/api/persona/pulse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, aiUsed }),
  });
  if (!res.ok) throw new Error("PERSONA_API_ERROR");
  return res.json();
}

/** assumption_used log — call after a kenmerk actually shaped an AI suggestion. */
export async function gebruikKenmerk(id, objectId, context) {
  const { apiUrl } = getSettings();
  const res = await fetch(`${apiUrl}/api/persona/kenmerken/${id}/gebruik`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ objectId, context }),
  });
  if (!res.ok) throw new Error("PERSONA_API_ERROR");
  return res.json();
}

/**
 * Whether a kenmerk is confident enough to actually influence AI suggestions.
 * "gevoelig" kenmerken (personality judgments like "ongeduldig") are never
 * usable on zekerheid alone, no matter how many sources support them — they
 * always need an explicit confirm first, same trust bar as a maker-confirmed
 * choice elsewhere in this ecosystem.
 */
export function magGebruiktWorden(kenmerk, instelling) {
  if (kenmerk.status === "confirmed") return true;
  if (kenmerk.gevoelig) return false;
  return kenmerk.zekerheid >= instelling.confidence_threshold;
}

/**
 * Kenmerken confident enough to actually influence AI suggestions elsewhere in
 * the app (AI Pulse, auto-tagging, AI Weave) — never "rejected", and either
 * confirmed or at/above the confidence threshold (and not "gevoelig").
 */
export async function getAssumptionsUsed() {
  const state = await getPersonaState();
  if (!state) return [];
  const { instelling, kenmerken } = state;
  return kenmerken.filter((k) => magGebruiktWorden(k, instelling));
}

/**
 * Scans recent objects for persona patterns and writes findings to the local
 * Persona API — either reinforcing an existing kenmerk or creating a new one.
 * Returns the number of candidates processed, or -1 if the local server or
 * AI isn't reachable/configured (same convention as pollInbox()).
 */
export async function detectPersonaKenmerken(limit = 30) {
  const { apiUrl } = getSettings();
  if (!apiUrl || !AIService.isConfigured()) return -1;
  try {
    const [rejected, allObjects] = await Promise.all([
      fetchRejectedKenmerken(apiUrl).catch(() => []),
      objectRepository.list(),
    ]);

    // Only scan objects updated since the last detection run
    const objectsToProcess = allObjects.filter((o) => {
      return !o.processedAt || (o.updatedAt && o.updatedAt > o.processedAt);
    }).slice(0, limit);

    if (!objectsToProcess.length) return 0;

    // Pass the top 20 recently rejected traits as negative feedback to LLM
    const recentRejected = rejected.slice(0, 20);

    const candidates = await AIService.suggestPersonaKenmerken(recentRejected, objectsToProcess);
    let processed = 0;
    for (const c of candidates) {
      if (!c?.kenmerk || !c?.bronObjectId) continue;
      try {
        if (c.categorie === "algemeen") {
          await createKennisObject(c.kenmerk, c.bronObjectId);
        } else {
          // Server handles duplicate detection and automatically reinforces if match is found
          await createKenmerk(apiUrl, c.kenmerk, c.bronObjectId, c.soort, c.gevoelig);
        }
        processed += 1;
      } catch (err) {
        console.error("Failed to save extracted candidate:", err);
      }
    }

    // Mark processed objects
    const scanTime = new Date().toISOString();
    for (const o of objectsToProcess) {
      await objectRepository.update(o.id, {
        processedAt: scanTime,
        updatedAt: o.updatedAt, // preserve original updatedAt
      });
    }

    return processed;
  } catch (err) {
    console.error("detectPersonaKenmerken error:", err);
    return -1; // local server or AI unreachable
  }
}

/**
 * Runs the temporal reflection process — how kenmerken evolved over time.
 * `sinceIso`, if given, restricts the scan to objects touched since that
 * timestamp — used by the automatic background run (see
 * runAutomaticPersonaMaintenance below) so it only re-reflects on what's
 * actually new since the last automatic pass, rather than re-scanning every
 * temporal object on every run. The manual "Temporal reflection" button in
 * PersonaDialog always calls this with no argument — a full scan, since
 * that's what clicking it explicitly asks for.
 */
export async function reflecteerOverTijd(sinceIso) {
  const { apiUrl } = getSettings();
  if (!apiUrl || !AIService.isConfigured()) return { success: false, reason: "NOT_CONFIGURED" };
  try {
    const [allTraits, allObjects] = await Promise.all([
      fetchAlleKenmerken(),
      objectRepository.list()
    ]);

    // 1. Filter objects that have temporal metadata
    let temporalObjects = allObjects.filter(
      (o) => o.occurredAt || o.validFrom || o.validTo || o.temporalText
    );
    if (sinceIso) {
      temporalObjects = temporalObjects.filter((o) => (o.updatedAt || o.createdAt || "") > sinceIso);
    }

    if (temporalObjects.length === 0) {
      return { success: false, reason: "NO_TEMPORAL_DATA" };
    }

    // 2. Sort chronologically
    temporalObjects.sort((a, b) => {
      const dateA = a.occurredAt || a.createdAt || "";
      const dateB = b.occurredAt || b.createdAt || "";
      return dateA.localeCompare(dateB);
    });

    // 3. Call LLM to reflect on timeline and identify changes
    const reflections = await AIService.reflectTemporalBeliefs(allTraits, temporalObjects);
    if (!reflections || reflections.length === 0) {
      return { success: true, reflectionsCount: 0 };
    }

    // 4. Send modifications to the server
    const res = await fetch(`${apiUrl}/api/persona/reflectie`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creations: reflections.filter((r) => r.action === "create"),
        updates: reflections.filter((r) => r.action === "update"),
      }),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || "Temporal reflection transaction failed");
    }

    const data = await res.json();
    return { success: true, reflectionsCount: reflections.length, created: data.created };
  } catch (err) {
    console.error("reflecteerOverTijd error:", err);
    return { success: false, reason: err.message || "ERROR" };
  }
}

// Timestamp of the last automatic (not manual-button) reflection run, so
// runAutomaticPersonaMaintenance can pass it as reflecteerOverTijd's
// sinceIso — see that function's doc comment for why.
const LAST_AUTO_REFLECTION_KEY = "chronicle_last_auto_temporal_reflection_at";

/**
 * Periodic background counterpart to PersonaDialog's manual "Detect
 * patterns" / "Temporal reflection" buttons — called on a timer from
 * App.js. Safe to call often: detectPersonaKenmerken() already only does
 * LLM work for objects it hasn't scanned yet (its own processedAt
 * watermark), and reflection is scoped to what changed since the last
 * automatic run via LAST_AUTO_REFLECTION_KEY — both are cheap no-ops when
 * there's nothing new, so the actual cadence naturally lands somewhere
 * between "every tick" and "only after a burst of new material", without
 * this function needing its own separate scheduling logic.
 */
export async function runAutomaticPersonaMaintenance() {
  if (!AIService.isConfigured()) return { detected: 0, reflected: 0 };

  const detected = await detectPersonaKenmerken();

  const sinceIso = localStorage.getItem(LAST_AUTO_REFLECTION_KEY) || undefined;
  const res = await reflecteerOverTijd(sinceIso);
  if (res.success) {
    localStorage.setItem(LAST_AUTO_REFLECTION_KEY, new Date().toISOString());
  }

  return {
    detected: typeof detected === "number" && detected > 0 ? detected : 0,
    reflected: res.success && res.reflectionsCount > 0 ? res.reflectionsCount : 0,
  };
}
