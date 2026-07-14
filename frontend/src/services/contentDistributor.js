// The shared triage step ahead of persona detection and hypothesis
// detection — one cheap classification pass per object instead of each
// downstream pipeline independently running its own full extraction-grade
// LLM call to decide the same thing. Run this first in the maintenance
// cycle (see App.js) so personaRelevant/hypothesisRelevant are fresh before
// detectPersonaKenmerken/detectHypothesisCandidates read them.
import { objectRepository } from "@/repositories";
import { AIService } from "@/services/AIService";

/**
 * Triages objects updated since the last distribution pass. Returns the
 * number of objects actually tagged, or -1 if the local server or AI isn't
 * reachable/configured (same convention as the pipelines that consume this).
 */
export async function runDistributor(limit = 50) {
  if (!AIService.isConfigured()) return -1;
  try {
    const allObjects = await objectRepository.list();
    const objectsToDistribute = allObjects
      .filter((o) => !o.distributedAt || (o.updatedAt && o.updatedAt > o.distributedAt))
      .slice(0, limit);
    if (!objectsToDistribute.length) return 0;

    const results = await AIService.triageObjects(objectsToDistribute);
    const byId = new Map(results.map((r) => [r.objectId, r]));

    const scanTime = new Date().toISOString();
    let tagged = 0;
    for (const o of objectsToDistribute) {
      const result = byId.get(o.id);
      // Missing from the model's response — leave distributedAt untouched
      // so this object is retried next cycle instead of being silently
      // marked "seen" with no actual verdict.
      if (!result) continue;
      await objectRepository.update(o.id, {
        personaRelevant: !!result.personaRelevant,
        hypothesisRelevant: !!result.hypothesisRelevant,
        distributedAt: scanTime,
        updatedAt: o.updatedAt, // bookkeeping, not a real edit
      });
      tagged += 1;
    }
    return tagged;
  } catch (err) {
    console.error("runDistributor error:", err);
    return -1;
  }
}
