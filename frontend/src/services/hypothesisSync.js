// Automatic hypothesis/evidence extraction — the background counterpart to
// MemoryDialog's manual "New hypothesis" / "Link evidence" buttons, mirroring
// personaSync.js's detectPersonaKenmerken for the epistemic-memory layer.
// Scans objects the same way persona detection does, but freezes each
// finding as an immutable episode first (server/episodePolicy.js) before
// interpreting it as evidence — so the raw observation stays intact even if
// the hypothesis it was linked to is later re-evaluated.
import { objectRepository } from "@/repositories";
import { AIService } from "@/services/AIService";
import {
  listHypotheses,
  createEpisode,
  createHypothesis,
  linkEvidence,
  MemoryApiError,
} from "@/services/memoryApi";

// Chronicle only has direct provenance signals for two source kinds today:
// a chat's turns came from a conversation import, and "activity" objects are
// passive UIA/Screenpipe capture. Everything else (notes, tasks, ideas, ...)
// is something the owner wrote themselves — "explicit-input", the same
// epistemic weight as an explicit confirmation. There's no current signal
// for "document" (e.g. an imported PDF); nothing maps to it yet.
export function inferSourceType(object) {
  if (object.type === "chat") return "chat-import";
  if (object.type === "activity") return "system-observation";
  return "explicit-input";
}

function buildEpisodeInput(object, candidate) {
  return {
    bronObjectId: object.id,
    bronsoort: object.type || "untyped",
    fragment: candidate.fragment,
    spreker: candidate.spreker || null,
    // Best available signal for when the source content itself occurred —
    // a chat's own dated timestamp, falling back to when the object was
    // first created. Not per-turn precise, but real, not invented.
    observedAt: object.occurredAt || object.createdAt || null,
    conversationIdentity: object.providerConversationId || null,
    sourceType: inferSourceType(object),
    extractionConfidence:
      Number.isInteger(candidate.extractionConfidence) && candidate.extractionConfidence >= 0 && candidate.extractionConfidence <= 100
        ? candidate.extractionConfidence
        : null,
  };
}

/**
 * Scans recent objects for hypothesis-worthy observations and writes
 * findings to the local memory API — either as new evidence for an existing
 * open hypothesis, or as a genuinely new hypothesis. Returns the number of
 * candidates processed, or -1 if the local server or AI isn't reachable/
 * configured (same convention as detectPersonaKenmerken/pollInbox).
 */
export async function detectHypothesisCandidates(limit = 30) {
  if (!AIService.isConfigured()) return -1;
  try {
    const openHypotheses = await listHypotheses("open").catch(() => []);
    const allObjects = await objectRepository.list();

    // Only scan objects updated since the last hypothesis-detection run —
    // its own watermark, separate from persona detection's processedAt
    // (see ObjectRepository.js's hypothesisProcessedAt comment for why).
    const objectsToProcess = allObjects
      .filter((o) => !o.hypothesisProcessedAt || (o.updatedAt && o.updatedAt > o.hypothesisProcessedAt))
      .slice(0, limit);

    if (!objectsToProcess.length) return 0;

    const candidates = await AIService.suggestHypothesisCandidates(openHypotheses, objectsToProcess);
    const openById = new Map(openHypotheses.map((h) => [h.id, h]));

    let processed = 0;
    for (const c of candidates) {
      if (!c?.bronObjectId || !c?.fragment || !c?.richting) continue;
      const object = objectsToProcess.find((o) => o.id === c.bronObjectId);
      if (!object) continue;

      try {
        const episode = await createEpisode(buildEpisodeInput(object, c));

        let hypothesisId = c.existingHypothesisId && openById.has(c.existingHypothesisId) ? c.existingHypothesisId : null;
        if (!hypothesisId) {
          if (!c.hypothese) continue; // neither an existing match nor a new proposal — nothing to do
          const created = await createHypothesis({
            hypothese: c.hypothese,
            verificatieCriteria: c.verificatieCriteria,
            bevestigingsCriteria: c.bevestigingsCriteria,
            afwijzingsCriteria: c.afwijzingsCriteria,
          });
          hypothesisId = created.id;
          openById.set(created.id, created); // available for later candidates in this same batch
        }

        await linkEvidence(hypothesisId, episode.id, c.richting);
        processed += 1;
      } catch (err) {
        // 409 (already linked) is an expected, harmless overlap with a prior
        // run or a duplicate suggestion in the same batch — not a failure.
        if (!(err instanceof MemoryApiError && err.status === 409)) {
          console.error("Failed to save extracted hypothesis candidate:", err);
        }
      }
    }

    // Mark processed objects, same "preserve original updatedAt" pattern as
    // detectPersonaKenmerken — this is bookkeeping, not a real edit.
    const scanTime = new Date().toISOString();
    for (const o of objectsToProcess) {
      await objectRepository.update(o.id, {
        hypothesisProcessedAt: scanTime,
        updatedAt: o.updatedAt,
      });
    }

    return processed;
  } catch (err) {
    console.error("detectHypothesisCandidates error:", err);
    return -1; // local server or AI unreachable
  }
}
