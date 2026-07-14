import { getSettings } from "@/lib/settings";

export class MemoryApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "MemoryApiError";
    this.status = status;
  }
}

async function memoryRequest(path, options = {}) {
  const { apiUrl } = getSettings();
  if (!apiUrl) throw new MemoryApiError("No local API URL configured", 0);

  let response;
  try {
    response = await fetch(`${apiUrl}/api/memory${path}`, {
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new MemoryApiError("Local memory service is unreachable", 0);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallback = response.status === 500
      ? "Memory schema may need migration (`npm run db:migrate`)"
      : `Memory request failed (${response.status})`;
    throw new MemoryApiError(body.error || fallback, response.status);
  }
  return body;
}

export function listHypotheses(status) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return memoryRequest(`/hypotheses${query}`);
}

// Semantic search across hypotheses and facts together — each result carries
// its own semanticRelevance/temporalFit/sourceQuality/confidence axes
// (server/retrievalPolicy.js), not just a combined score, so a caller can
// re-rank or filter by whichever axis matters for the question at hand.
export function searchMemory(q, { asOf, limit } = {}) {
  const params = new URLSearchParams({ q });
  if (asOf) params.set("asOf", asOf);
  if (limit) params.set("limit", String(limit));
  return memoryRequest(`/search?${params.toString()}`);
}

// Every confirmed hypothesis's resulting fact — a distinct, append-only
// record, not just a status flag on the hypothesis (see server/routes/
// memory.js's /hypotheses/:id/confirm for how a fact comes to exist).
// { active: true } restricts to facts nothing has superseded yet — the set
// hypothesisReflectionSync.js scans so it never proposes replacing an
// already-replaced fact.
export function listFacts({ active } = {}) {
  const query = active ? "?active=true" : "";
  return memoryRequest(`/facts${query}`);
}

// Episodes captured since `sinceIso` (all of them if omitted) — recent raw
// observations for the reflection pipeline to weigh against active facts.
export function listEpisodesSince(sinceIso) {
  const query = sinceIso ? `?since=${encodeURIComponent(sinceIso)}` : "";
  return memoryRequest(`/episodes${query}`);
}

export function exportMemory() {
  return memoryRequest("/export");
}

export function restoreMemory(memory) {
  return memoryRequest("/restore", {
    method: "POST",
    body: JSON.stringify(memory),
  });
}

export function preflightMemoryRestore(memory) {
  return memoryRequest("/restore/preflight", {
    method: "POST",
    body: JSON.stringify(memory),
  });
}

export function getMemoryStorageInventory() {
  return memoryRequest("/maintenance/storage");
}

export function getObjectIndexInventory() {
  return memoryRequest("/maintenance/object-indexes");
}

export function purgeDerivedMemory() {
  return memoryRequest("/maintenance/purge-derived", {
    method: "POST",
    body: JSON.stringify({ confirmation: "PURGE_DERIVED_MEMORY" }),
  });
}

export function auditMemoryIntegrity(objectIds) {
  return memoryRequest("/maintenance/integrity-audit", {
    method: "POST",
    body: JSON.stringify({ objectIds }),
  });
}

export function purgeOrphanDerivedIndexes(objectIds) {
  return memoryRequest("/maintenance/purge-orphan-indexes", {
    method: "POST",
    body: JSON.stringify({ objectIds, confirmation: "PURGE_ORPHAN_DERIVED_INDEXES" }),
  });
}

export function getHypothesis(id) {
  return memoryRequest(`/hypotheses/${encodeURIComponent(id)}`);
}

// Accepts either a plain string (MemoryDialog's manual "New hypothesis"
// input — text only, no criteria) or a full candidate object with
// verification/confirmation/rejection criteria (hypothesisSync.js's
// automatic extraction, which can state them concretely from the source) and
// optionally validFrom/validTo/temporalText/supersedesFactId
// (hypothesisReflectionSync.js — set when this hypothesis, if confirmed,
// replaces an existing fact rather than standing alone).
export function createHypothesis(hypothese) {
  const body =
    typeof hypothese === "string"
      ? { hypothese }
      : {
          hypothese: hypothese.hypothese,
          verificatieCriteria: hypothese.verificatieCriteria,
          bevestigingsCriteria: hypothese.bevestigingsCriteria,
          afwijzingsCriteria: hypothese.afwijzingsCriteria,
          validFrom: hypothese.validFrom,
          validTo: hypothese.validTo,
          temporalText: hypothese.temporalText,
          supersedesFactId: hypothese.supersedesFactId,
        };
  return memoryRequest("/hypotheses", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createEpisode(episode) {
  return memoryRequest("/episodes", {
    method: "POST",
    body: JSON.stringify(episode),
  });
}

export function getSourceUsage(bronObjectId) {
  return memoryRequest(`/sources/${encodeURIComponent(bronObjectId)}/usage`);
}

export function linkEvidence(hypothesisId, episodeId, richting) {
  return memoryRequest(`/hypotheses/${encodeURIComponent(hypothesisId)}/evidence`, {
    method: "POST",
    body: JSON.stringify({ episodeId, richting }),
  });
}

export function confirmHypothesis(id) {
  return memoryRequest(`/hypotheses/${encodeURIComponent(id)}/confirm`, { method: "PATCH" });
}

export function rejectHypothesis(id, reden) {
  return memoryRequest(`/hypotheses/${encodeURIComponent(id)}/reject`, {
    method: "PATCH",
    body: JSON.stringify({ reden }),
  });
}
