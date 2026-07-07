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
      return !o.lastProcessedForPersonaAt || (o.updatedAt && o.updatedAt > o.lastProcessedForPersonaAt);
    }).slice(0, limit);

    if (!objectsToProcess.length) return 0;

    // Pass the top 20 recently rejected traits as negative feedback to LLM
    const recentRejected = rejected.slice(0, 20);

    const candidates = await AIService.suggestPersonaKenmerken(recentRejected, objectsToProcess);
    let processed = 0;
    for (const c of candidates) {
      if (!c?.kenmerk || !c?.bronObjectId) continue;
      try {
        // Server handles duplicate detection and automatically reinforces if match is found
        await createKenmerk(apiUrl, c.kenmerk, c.bronObjectId, c.soort, c.gevoelig);
        processed += 1;
      } catch (err) {
        console.error("Failed to save persona candidate:", err);
      }
    }

    // Mark processed objects
    const scanTime = new Date().toISOString();
    for (const o of objectsToProcess) {
      await objectRepository.update(o.id, {
        lastProcessedForPersonaAt: scanTime,
        updatedAt: o.updatedAt, // preserve original updatedAt
      });
    }

    return processed;
  } catch (err) {
    console.error("detectPersonaKenmerken error:", err);
    return -1; // local server or AI unreachable
  }
}
