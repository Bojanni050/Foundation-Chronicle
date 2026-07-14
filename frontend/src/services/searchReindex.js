import { objectRepository } from "@/repositories";
import { getObjectIndexInventory } from "@/services/memoryApi";
import { embedObjectDetailed } from "@/services/objectEmbedding";

function expectedChunkCount(object) {
  const validTurns = (object.turns || []).filter((turn) => (turn?.text || "").trim());
  if (validTurns.length) return validTurns.length;
  return (object.content || "").trim() ? 1 : 0;
}

export function selectObjectsForReindex(objects, indexes, { force = false } = {}) {
  const byId = new Map(indexes.map((index) => [index.object_id, index]));
  return objects.filter((object) => {
    const expectedChunks = expectedChunkCount(object);
    if (!expectedChunks) return false;
    if (force) return true;
    const index = byId.get(object.id);
    if (!index?.object_indexed_at || index.chunk_count !== expectedChunks || index.embedded_chunk_count < expectedChunks) return true;
    return new Date(index.object_indexed_at).getTime() < new Date(object.updatedAt || object.createdAt || 0).getTime();
  });
}

export async function rebuildSearchIndex({ force = false, signal, onProgress } = {}) {
  const [objects, indexes] = await Promise.all([objectRepository.list(), getObjectIndexInventory()]);
  const candidates = selectObjectsForReindex(objects, indexes, { force });
  const progress = {
    total: candidates.length,
    completed: 0,
    succeeded: 0,
    failed: 0,
    skipped: objects.length - candidates.length,
    cancelled: false,
    failures: [],
  };
  onProgress?.({ ...progress });

  for (const object of candidates) {
    if (signal?.aborted) {
      progress.cancelled = true;
      break;
    }
    onProgress?.({ ...progress, currentTitle: object.title || "Untitled" });
    const result = await embedObjectDetailed(object.id, object.turns, object.content, { signal });
    if (result.aborted) {
      progress.cancelled = true;
      break;
    }
    progress.completed += 1;
    if (result.ok) {
      progress.succeeded += 1;
    } else {
      progress.failed += 1;
      progress.failures.push({ id: object.id, title: object.title || "Untitled", error: result.error || "Embedding incomplete" });
    }
    onProgress?.({ ...progress, failures: [...progress.failures] });
  }
  onProgress?.({ ...progress, currentTitle: null, failures: [...progress.failures] });
  return progress;
}
