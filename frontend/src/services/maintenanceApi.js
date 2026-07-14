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

export async function loadDataInventory() {
  const referencedIds = await referencedAttachmentIds();
  const [attachments, memory] = await Promise.all([
    attachmentRequest("/inventory", { referencedIds }),
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

export { purgeDerivedMemory };
