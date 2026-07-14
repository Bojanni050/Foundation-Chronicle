import { objectRepository } from "@/repositories";
import { getSettings, saveSettings } from "@/lib/settings";
import { BUILTIN_TYPE_KEYS, getCustomTypes, mergeCustomTypes, setCustomTypes } from "@/lib/typeRegistry";
import { exportMemory, preflightMemoryRestore, restoreMemory } from "@/services/memoryApi";
import { inspectAttachmentIds, loadDataInventory } from "@/services/maintenanceApi";

export const BACKUP_FORMAT = "foundation-chronicle-backup";
export const BACKUP_VERSION = 1;
const LAST_BACKUP_KEY = "chronicle_last_backup_export";

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new Error("Attachment contains invalid base64 data");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function sha256(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sourceFingerprints(objects, customTypes, workspace, memory) {
  return {
    objects: await sha256(JSON.stringify({ objects, customTypes, workspace })),
    memory: await sha256(JSON.stringify(memory.tables || {})),
  };
}

export function getLastBackupExport() {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_BACKUP_KEY) || "null");
    return value?.createdAt ? value : null;
  } catch {
    return null;
  }
}

function recordBackupExport(backup) {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, JSON.stringify({
      createdAt: backup.manifest.createdAt,
      contentSha256: backup.manifest.contentSha256,
      counts: backup.manifest.counts,
      sourceFingerprints: backup.manifest.sourceFingerprints,
    }));
  } catch {
    // Export itself remains valid when operational metadata cannot be stored.
  }
}

export function classifyBackupReadiness(lastExport, currentFingerprints, missingReferencedCount) {
  if (missingReferencedCount > 0) return "blocked";
  if (!lastExport?.sourceFingerprints) return lastExport ? "unknown" : "never";
  if (lastExport.sourceFingerprints.objects !== currentFingerprints.objects
      || lastExport.sourceFingerprints.memory !== currentFingerprints.memory) return "outdated";
  return "current";
}

export async function checkBackupReadiness() {
  const settings = getSettings();
  const [objects, memory, inventory] = await Promise.all([
    objectRepository.list(),
    exportMemory(),
    loadDataInventory(),
  ]);
  const customTypes = getCustomTypes();
  const workspace = { name: settings.workspaceName || "Personal workspace" };
  const fingerprints = await sourceFingerprints(objects, customTypes, workspace, memory);
  const lastExport = getLastBackupExport();
  const invalidAttachmentReferences = objects.reduce(
    (count, object) => count + (object.attachments || []).filter((attachment) => !/^[a-f0-9]{24}$/.test(attachment.id || "")).length,
    0,
  );
  const missingReferencedCount = (inventory.attachments.missingReferencedCount || 0) + invalidAttachmentReferences;
  return {
    status: classifyBackupReadiness(
      lastExport,
      fingerprints,
      missingReferencedCount,
    ),
    lastExport,
    missingReferencedCount,
    missingReferencedIds: inventory.attachments.missingReferencedIds || [],
    currentCounts: {
      objects: objects.length,
      attachments: inventory.referencedAttachments,
      episodes: memory.tables?.episodes?.length || 0,
    },
  };
}

async function exportAttachments(objects, apiUrl) {
  const unique = new Map();
  for (const object of objects) {
    for (const attachment of object.attachments || []) {
      const key = attachment.id || attachment.url;
      if (key && !unique.has(key)) unique.set(key, attachment);
    }
  }

  const exported = [];
  for (const attachment of unique.values()) {
    if (!attachment.url) {
      throw new Error(`Attachment backup failed: ${attachment.filename || attachment.id} has no source URL`);
    }
    const url = /^https?:\/\//i.test(attachment.url || "")
      ? attachment.url
      : `${apiUrl.replace(/\/+$/, "")}${attachment.url}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Attachment backup failed: ${attachment.filename || attachment.id} (HTTP ${response.status})`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    exported.push({
      id: attachment.id,
      filename: attachment.filename || "file",
      mimeType: attachment.mimeType || response.headers.get("Content-Type") || "application/octet-stream",
      size: bytes.length,
      sha256: await sha256(bytes),
      base64: bytesToBase64(bytes),
    });
  }
  return exported;
}

function withoutArchiveChecksum(backup) {
  const { contentSha256: _ignored, ...manifest } = backup.manifest;
  return { ...backup, manifest };
}

export async function validateChronicleBackup(backup) {
  if (!backup || backup.manifest?.format !== BACKUP_FORMAT) throw new Error("Not a Chronicle backup");
  if (backup.manifest.version !== BACKUP_VERSION) throw new Error(`Unsupported backup version: ${backup.manifest.version}`);
  if (!Array.isArray(backup.objects) || !Array.isArray(backup.customTypes) || !Array.isArray(backup.attachments)) {
    throw new Error("Backup is missing archive collections");
  }
  if (backup.memory?.format !== "foundation-chronicle-memory") throw new Error("Backup is missing PostgreSQL memory data");
  if (backup.memory.version !== 1 || !backup.memory.tables) throw new Error("Backup has unsupported memory data");
  const requiredMemoryTables = ["hypotheses", "episodes", "evidence", "knowledgeGaps", "knowledge", "knowledgeUsage", "personaSettings", "pulseCache"];
  if (requiredMemoryTables.some((name) => !Array.isArray(backup.memory.tables[name]))) {
    throw new Error("Backup is missing required memory tables");
  }
  const actualCounts = {
    objects: backup.objects.length,
    customTypes: backup.customTypes.length,
    attachments: backup.attachments.length,
    episodes: backup.memory.tables.episodes.length,
    hypotheses: backup.memory.tables.hypotheses.length,
    evidence: backup.memory.tables.evidence.length,
  };
  if (!backup.manifest.counts || Object.entries(actualCounts).some(([name, count]) => backup.manifest.counts[name] !== count)) {
    throw new Error("Backup manifest counts do not match archive contents");
  }
  const expected = await sha256(JSON.stringify(withoutArchiveChecksum(backup)));
  if (backup.manifest.contentSha256 !== expected) throw new Error("Backup checksum mismatch");
  const customTypeKeys = new Set();
  const reservedTypeKeys = new Set([...BUILTIN_TYPE_KEYS, "all", "untyped"]);
  for (const type of backup.customTypes) {
    if (!type || typeof type.key !== "string" || !type.key || reservedTypeKeys.has(type.key) || customTypeKeys.has(type.key)) {
      throw new Error(`Invalid or duplicate custom type: ${type?.key || "unknown"}`);
    }
    customTypeKeys.add(type.key);
  }
  const validTypes = new Set([...BUILTIN_TYPE_KEYS, ...customTypeKeys]);
  const objectIds = new Set();
  for (const object of backup.objects) {
    if (!object || typeof object.id !== "string" || !object.id || objectIds.has(object.id)) {
      throw new Error(`Invalid or duplicate object id: ${object?.id || "unknown"}`);
    }
    if (object.type && !validTypes.has(object.type)) throw new Error(`Object ${object.id} has unknown type: ${object.type}`);
    objectIds.add(object.id);
  }
  const attachmentIds = new Set();
  for (const attachment of backup.attachments) {
    if (!/^[a-f0-9]{24}$/.test(attachment.id || "") || attachmentIds.has(attachment.id)) {
      throw new Error(`Invalid or duplicate attachment id: ${attachment.id || "unknown"}`);
    }
    attachmentIds.add(attachment.id);
    const bytes = base64ToBytes(attachment.base64 || "");
    if (bytes.length !== attachment.size || await sha256(bytes) !== attachment.sha256) {
      throw new Error(`Attachment checksum mismatch: ${attachment.filename || attachment.id}`);
    }
  }
  for (const object of backup.objects) {
    for (const attachment of object.attachments || []) {
      if (!attachmentIds.has(attachment.id)) {
        throw new Error(`Object ${object.id} references a missing attachment`);
      }
    }
  }
  return true;
}

export async function readChronicleBackupFile(file) {
  if (!file) throw new Error("Choose a Chronicle backup file");
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    throw new Error("Backup is not valid JSON");
  }
  await validateChronicleBackup(backup);
  const preflight = await preflightMemoryRestore(backup.memory);
  const impact = await buildRestoreImpact(backup, preflight);
  return { backup, preflight, impact };
}

export async function buildRestoreImpact(backup, preflight) {
  const settings = getSettings();
  const [existingObjects, attachmentInventory] = await Promise.all([
    objectRepository.list(),
    inspectAttachmentIds(backup.attachments.map((attachment) => attachment.id)),
  ]);
  const existingObjectIds = new Set(existingObjects.map((object) => object.id));
  const existingTypeKeys = new Set(getCustomTypes().map((type) => type.key));
  const overwrittenObjectIds = backup.objects
    .map((object) => object.id)
    .filter((id) => existingObjectIds.has(id));
  const overwrittenTypeKeys = backup.customTypes
    .map((type) => type.key)
    .filter((key) => existingTypeKeys.has(key));
  const newAttachmentIds = attachmentInventory.missingReferencedIds || [];
  return {
    objects: {
      added: backup.objects.length - overwrittenObjectIds.length,
      overwritten: overwrittenObjectIds.length,
      overwrittenIds: overwrittenObjectIds.slice(0, 10),
    },
    customTypes: {
      added: backup.customTypes.length - overwrittenTypeKeys.length,
      overwritten: overwrittenTypeKeys.length,
      overwrittenKeys: overwrittenTypeKeys.slice(0, 10),
    },
    attachments: {
      added: newAttachmentIds.length,
      reused: backup.attachments.length - newAttachmentIds.length,
    },
    workspace: {
      changes: Boolean(backup.workspace?.name && backup.workspace.name !== settings.workspaceName),
      currentName: settings.workspaceName,
      restoredName: backup.workspace?.name || settings.workspaceName,
    },
    memory: {
      episodesAdded: Math.max(0, (preflight.counts.episodes || 0) - preflight.episodeReused),
      episodesReused: preflight.episodeReused,
      hypothesesProcessed: preflight.counts.hypotheses || 0,
      evidenceProcessed: preflight.counts.evidence || 0,
    },
  };
}

async function getLocalApiToken(settings) {
  if (settings.apiToken) return settings.apiToken;
  const response = await fetch(`${settings.apiUrl.replace(/\/+$/, "")}/api/settings/token`);
  if (!response.ok) throw new Error("Could not obtain the local restore token");
  const { token } = await response.json();
  if (!token) throw new Error("Local restore token is unavailable");
  return token;
}

async function attachmentSessionRequest(settings, token, path, body) {
  const response = await fetch(`${settings.apiUrl.replace(/\/+$/, "")}/api/attachments${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Attachment restore session failed (${response.status})`);
  return result;
}

async function createAttachmentRestoreSession(settings, token) {
  return attachmentSessionRequest(settings, token, "/restore-sessions");
}

async function restoreAttachments(attachments, settings, token, sessionId) {
  for (const attachment of attachments) {
    const response = await fetch(
      `${settings.apiUrl.replace(/\/+$/, "")}/api/attachments/restore-sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(attachment.id)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          // Always send binary here. application/json attachments would be
          // consumed by the server's global JSON parser before the raw route.
          "Content-Type": "application/octet-stream",
          "X-Attachment-Mime-Type": attachment.mimeType || "application/octet-stream",
          "X-Attachment-Filename": encodeURIComponent(attachment.filename || "file"),
        },
        body: base64ToBytes(attachment.base64),
      },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Attachment restore failed (${response.status})`);
  }
}

export async function mergeChronicleBackup(backup) {
  await validateChronicleBackup(backup);
  const settings = getSettings();
  const previousObjects = await objectRepository.list();
  const previousTypes = getCustomTypes();
  const previousWorkspaceName = settings.workspaceName;
  let attachmentSessionId = null;
  let memoryCommitted = false;

  try {
    if (backup.attachments.length) {
      const token = await getLocalApiToken(settings);
      attachmentSessionId = (await createAttachmentRestoreSession(settings, token)).id;
      await restoreAttachments(backup.attachments, settings, token, attachmentSessionId);
    }
    mergeCustomTypes(backup.customTypes);
    await objectRepository.mergeAll(backup.objects);
    if (backup.workspace?.name) saveSettings({ workspaceName: backup.workspace.name });
    const memoryResult = await restoreMemory(backup.memory);
    memoryCommitted = true;
    let cleanupWarning = null;
    if (attachmentSessionId) {
      try {
        const token = await getLocalApiToken(settings);
        await attachmentSessionRequest(
          settings,
          token,
          `/restore-sessions/${encodeURIComponent(attachmentSessionId)}/finalize`,
          { confirmation: "FINALIZE_ATTACHMENT_RESTORE" },
        );
      } catch (err) {
        cleanupWarning = `Restore committed, but attachment session finalization failed: ${err.message}`;
      }
    }
    return {
      ...memoryResult,
      objects: backup.objects.length,
      customTypes: backup.customTypes.length,
      attachments: backup.attachments.length,
      cleanupWarning,
    };
  } catch (err) {
    if (!memoryCommitted) {
      if (attachmentSessionId) {
        try {
          const token = await getLocalApiToken(settings);
          await attachmentSessionRequest(
            settings,
            token,
            `/restore-sessions/${encodeURIComponent(attachmentSessionId)}/rollback`,
            { confirmation: "ROLLBACK_ATTACHMENT_RESTORE" },
          );
        } catch (rollbackError) {
          err.attachmentRollbackError = rollbackError.message;
        }
      }
      // PostgreSQL rolls itself back transactionally. Restore the browser
      // stores too, leaving only an explicit warning if attachment rollback failed.
      setCustomTypes(previousTypes);
      await objectRepository.replaceAll(previousObjects);
      saveSettings({ workspaceName: previousWorkspaceName });
    }
    throw err;
  }
}

export async function buildChronicleBackup() {
  const settings = getSettings();
  const createdAt = new Date().toISOString();
  const [objects, memory] = await Promise.all([objectRepository.list(), exportMemory()]);
  const customTypes = getCustomTypes();
  const attachments = await exportAttachments(objects, settings.apiUrl);
  const workspace = { name: settings.workspaceName || "Personal workspace" };
  const fingerprints = await sourceFingerprints(objects, customTypes, workspace, memory);

  const backup = {
    manifest: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt,
      application: "Foundation-Chronicle",
      excludes: [
        "API keys and tokens",
        "PIN and username",
        "local model paths",
        "derived embeddings and search chunks",
      ],
      counts: {
        objects: objects.length,
        customTypes: customTypes.length,
        attachments: attachments.length,
        episodes: memory.tables?.episodes?.length || 0,
        hypotheses: memory.tables?.hypotheses?.length || 0,
        evidence: memory.tables?.evidence?.length || 0,
      },
      sourceFingerprints: fingerprints,
    },
    workspace,
    customTypes,
    objects,
    attachments,
    memory,
  };
  backup.manifest.contentSha256 = await sha256(JSON.stringify(backup));
  await validateChronicleBackup(backup);
  return backup;
}

export function downloadChronicleBackup(backup) {
  const date = backup.manifest.createdAt.slice(0, 10);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `foundation-chronicle-backup-${date}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  recordBackupExport(backup);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
