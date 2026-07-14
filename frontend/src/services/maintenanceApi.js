import { objectRepository } from "@/repositories";
import { getSettings } from "@/lib/settings";
import { getMemoryStorageInventory, purgeDerivedMemory } from "@/services/memoryApi";

async function referencedAttachmentIds() {
  const objects = await objectRepository.list();
  return [...new Set(objects.flatMap((object) => (object.attachments || []).map((attachment) => attachment.id)).filter(Boolean))];
}

async function localToken(settings) {
  if (settings.apiToken) return settings.apiToken;
  const response = await fetch(`${settings.apiUrl.replace(/\/+$/, "")}/api/settings/token`);
  if (!response.ok) throw new Error("Could not obtain the local maintenance token");
  const { token } = await response.json();
  if (!token) throw new Error("Local maintenance token is unavailable");
  return token;
}

async function attachmentRequest(path, body) {
  const settings = getSettings();
  const token = await localToken(settings);
  const response = await fetch(`${settings.apiUrl.replace(/\/+$/, "")}/api/attachments${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Attachment maintenance failed (${response.status})`);
  return result;
}

export function inspectAttachmentIds(referencedIds) {
  return attachmentRequest("/inventory", { referencedIds: [...new Set(referencedIds.filter(Boolean))] });
}

export async function loadDataInventory() {
  const referencedIds = await referencedAttachmentIds();
  const [attachments, memory] = await Promise.all([
    inspectAttachmentIds(referencedIds),
    getMemoryStorageInventory(),
  ]);
  return { attachments, memory, referencedAttachments: referencedIds.length };
}

export async function purgeOrphanAttachments() {
  const referencedIds = await referencedAttachmentIds();
  return attachmentRequest("/purge-orphans", {
    referencedIds,
    confirmation: "PURGE_ORPHAN_ATTACHMENTS",
  });
}

export async function inspectInterruptedRestoreSessions() {
  const referencedIds = new Set(await referencedAttachmentIds());
  const { sessions } = await attachmentRequest("/restore-sessions/inventory", {});
  return (sessions || []).map((session) => {
    const createdIds = session.createdAttachmentIds || [];
    const existingIds = new Set(session.existingAttachmentIds || []);
    const referencedCount = createdIds.filter((id) => referencedIds.has(id)).length;
    const missingFileCount = createdIds.filter((id) => !existingIds.has(id)).length;
    let disposition = "mixed";
    if (missingFileCount > 0) disposition = "attention";
    else if (referencedCount === createdIds.length) disposition = "finalize";
    else if (referencedCount === 0) disposition = "rollback";
    return { ...session, referencedCount, missingFileCount, disposition };
  });
}

export async function reconcileInterruptedRestoreSessions() {
  const sessions = await inspectInterruptedRestoreSessions();
  const result = { finalized: 0, rolledBack: 0, deletedAttachments: 0, unresolved: 0 };
  for (const session of sessions) {
    if (session.disposition === "finalize") {
      await attachmentRequest(`/restore-sessions/${encodeURIComponent(session.id)}/finalize`, {
        confirmation: "FINALIZE_ATTACHMENT_RESTORE",
      });
      result.finalized += 1;
    } else if (session.disposition === "rollback") {
      const rollback = await attachmentRequest(`/restore-sessions/${encodeURIComponent(session.id)}/rollback`, {
        confirmation: "ROLLBACK_ATTACHMENT_RESTORE",
      });
      result.rolledBack += 1;
      result.deletedAttachments += rollback.deleted || 0;
    } else {
      result.unresolved += 1;
    }
  }
  return result;
}

export { purgeDerivedMemory };
