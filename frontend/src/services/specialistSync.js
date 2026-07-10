import { getSettings } from "@/lib/settings";
import { objectRepository } from "@/repositories";
import { AIService } from "@/services/AIService";

async function fetchSpecialisten(apiUrl) {
  const res = await fetch(`${apiUrl}/api/specialist`);
  if (!res.ok) throw new Error("SPECIALIST_API_ERROR");
  return res.json();
}

/** Confirmed specialists only — what Gaia is allowed to delegate to. */
export async function getConfirmedSpecialisten() {
  const { apiUrl } = getSettings();
  if (!apiUrl) return [];
  try {
    const res = await fetch(`${apiUrl}/api/specialist`);
    if (!res.ok) return [];
    const all = await res.json();
    return all.filter((s) => s.status === "confirmed");
  } catch {
    return [];
  }
}

/** All specialists (incl. observations awaiting confirmation) for the panel. */
export async function getSpecialistState() {
  const { apiUrl } = getSettings();
  if (!apiUrl) return null;
  try {
    const kenmerken = await fetchSpecialisten(apiUrl);
    return { specialisten: kenmerken };
  } catch {
    return null;
  }
}

async function createOrReinforce(apiUrl, onderwerp, bronObjectId) {
  const res = await fetch(`${apiUrl}/api/specialist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ onderwerp, bronObjectId }),
  });
  if (!res.ok) throw new Error("SPECIALIST_API_ERROR");
  return res.json();
}

export async function updateSpecialist(id, patch) {
  const { apiUrl } = getSettings();
  const res = await fetch(`${apiUrl}/api/specialist/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("SPECIALIST_API_ERROR");
  return res.json();
}

/**
 * Confirm an observation candidate — generates the specialist's system
 * prompt via AI (based on its bronObjectIds evidence) and persists it.
 * Always visible/editable afterward via updateSpecialist().
 */
export async function confirmSpecialist(specialistRow) {
  const { apiUrl } = getSettings();
  const objects = await objectRepository.list();
  const bronObjects = objects.filter((o) => specialistRow.bron_object_ids.includes(o.id));
  const systemPrompt = await AIService.generateSpecialistPrompt(specialistRow.onderwerp, bronObjects);
  const res = await fetch(`${apiUrl}/api/specialist/${specialistRow.id}/bevestigen`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt }),
  });
  if (!res.ok) throw new Error("SPECIALIST_API_ERROR");
  return res.json();
}

export async function rejectSpecialist(id) {
  const { apiUrl } = getSettings();
  const res = await fetch(`${apiUrl}/api/specialist/${id}/verwerpen`, { method: "PATCH" });
  if (!res.ok) throw new Error("SPECIALIST_API_ERROR");
  return res.json();
}

/**
 * Scans recent `activity` objects for a tag/app that recurs often enough to
 * be worth specializing in. Same "observation, needs confirmation" pattern
 * as detectPersonaKenmerken() — never silently becomes a usable specialist.
 * Returns the number of candidates processed, or -1 if the local server
 * isn't reachable (same convention as pollInbox()/detectPersonaKenmerken()).
 */
export async function detectSpecialisten(minOccurrences = 5) {
  const { apiUrl } = getSettings();
  if (!apiUrl) return -1;
  try {
    const objects = await objectRepository.list({ type: "activity" });
    const counts = new Map();
    for (const o of objects) {
      for (const tag of o.tags || []) {
        if (!counts.has(tag)) counts.set(tag, []);
        counts.get(tag).push(o.id);
      }
    }
    let processed = 0;
    for (const [onderwerp, objectIds] of counts.entries()) {
      if (objectIds.length < minOccurrences) continue;
      try {
        await createOrReinforce(apiUrl, onderwerp, objectIds[objectIds.length - 1]);
        processed++;
      } catch (err) {
        console.error("Failed to save specialist candidate:", err);
      }
    }
    return processed;
  } catch (err) {
    console.error("detectSpecialisten error:", err);
    return -1;
  }
}
