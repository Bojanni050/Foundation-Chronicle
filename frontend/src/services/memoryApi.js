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

export function exportMemory() {
  return memoryRequest("/export");
}

export function restoreMemory(memory) {
  return memoryRequest("/restore", {
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

export function createHypothesis(hypothese) {
  return memoryRequest("/hypotheses", {
    method: "POST",
    body: JSON.stringify({ hypothese }),
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
