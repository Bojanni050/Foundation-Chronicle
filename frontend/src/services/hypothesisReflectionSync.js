// Hindsight-style temporal reflection for hypotheses/facts — the background
// job that reviews currently-active facts against recently captured episodes
// and proposes (never applies) a replacement hypothesis when something
// genuinely appears to have changed. See services/ai/hypothesisReflection.js
// for the classify-first discipline this exists to enforce.
//
// Deliberately proposal-only: every candidate becomes a new, "open"
// hypothesis via the normal createHypothesis path, carrying supersedesFactId
// so a human's later explicit confirmation (not this job) is what actually
// supersedes the old fact. Nothing here ever calls confirmHypothesis.
import { AIService } from "@/services/AIService";
import { listFacts, listEpisodesSince, createHypothesis, MemoryApiError } from "@/services/memoryApi";

const ALLOWED_CLASSIFICATIONS = ["echte_wijziging", "echte_contradictie"];

// Defensive gate before any candidate reaches a write: only "genuine change"
// or "genuine contradiction" classifications may propose a supersession, and
// only against a fact we actually sent the model — never a hallucinated id.
export function isValidReflectionCandidate(candidate, activeFactIds) {
  if (!candidate?.targetFactId || !candidate?.hypothese) return false;
  if (!ALLOWED_CLASSIFICATIONS.includes(candidate.classification)) return false;
  return activeFactIds.has(candidate.targetFactId);
}

// Timestamp of the last reflection run, so each pass only reviews episodes
// captured since then — cheap no-op when nothing new has come in, same
// "only re-run on genuinely new material" spirit as personaSync.js's own
// LAST_AUTO_REFLECTION_KEY.
const LAST_REFLECTION_KEY = "chronicle_last_hypothesis_reflection_at";

/**
 * Reviews active facts against episodes captured since the last run and
 * proposes replacement hypotheses for genuine changes/contradictions.
 * Returns the number of proposals created, or -1 if the local server or AI
 * isn't reachable/configured (same convention as detectHypothesisCandidates).
 */
export async function reflectOnHypotheses() {
  if (!AIService.isConfigured()) return -1;
  try {
    const activeFacts = await listFacts({ active: true });
    if (!activeFacts.length) return 0; // nothing yet to reflect on

    const sinceIso = localStorage.getItem(LAST_REFLECTION_KEY) || undefined;
    const recentEpisodes = await listEpisodesSince(sinceIso);
    if (!recentEpisodes.length) return 0;

    const candidates = await AIService.reflectOnFacts(activeFacts, recentEpisodes);
    const activeFactIds = new Set(activeFacts.map((f) => f.id));

    let processed = 0;
    for (const c of candidates) {
      if (!isValidReflectionCandidate(c, activeFactIds)) continue;

      try {
        await createHypothesis({
          hypothese: c.hypothese,
          verificatieCriteria: c.verificatieCriteria,
          bevestigingsCriteria: c.bevestigingsCriteria,
          afwijzingsCriteria: c.afwijzingsCriteria,
          temporalText: c.temporalText,
          supersedesFactId: c.targetFactId,
        });
        processed += 1;
      } catch (err) {
        if (!(err instanceof MemoryApiError && err.status === 404)) {
          console.error("Failed to save reflection proposal:", err);
        }
      }
    }

    localStorage.setItem(LAST_REFLECTION_KEY, new Date().toISOString());
    return processed;
  } catch (err) {
    console.error("reflectOnHypotheses error:", err);
    return -1;
  }
}
