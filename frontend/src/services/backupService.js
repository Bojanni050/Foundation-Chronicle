import { objectRepository } from "@/repositories";
import { getSettings, saveSettings } from "@/lib/settings";
import { getCustomTypes, mergeCustomTypes, setCustomTypes } from "@/lib/typeRegistry";
import { exportMemory, restoreMemory } from "@/services/memoryApi";

export const BACKUP_FORMAT = "foundation-chronicle-backup";
export const BACKUP_VERSION = 1;

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
  const expected = await sha256(JSON.stringify(withoutArchiveChecksum(backup)));
  if (backup.manifest.contentSha256 !== expected) throw new Error("Backup checksum mismatch");
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
  return backup;
}

async function getLocalApiToken(settings) {
  if (settings.apiToken) return settings.apiToken;
  const response = await fetch(`${settings.apiUrl.replace(/\/+$/, "")}/api/settings/token`);
  if (!response.ok) throw new Error("Could not obtain the local restore token");
  const { token } = await response.json();
  if (!token) throw new Error("Local restore token is unavailable");
  return token;
}

async function restoreAttachments(attachments, settings) {
  if (!attachments.length) return;
  const token = await getLocalApiToken(settings);
  for (const attachment of attachments) {
    const response = await fetch(
      `${settings.apiUrl.replace(/\/+$/, "")}/api/attachments/restore/${encodeURIComponent(attachment.id)}`,
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

  await restoreAttachments(backup.attachments, settings);
  try {
    mergeCustomTypes(backup.customTypes);
    await objectRepository.mergeAll(backup.objects);
    if (backup.workspace?.name) saveSettings({ workspaceName: backup.workspace.name });
    const memoryResult = await restoreMemory(backup.memory);
    return {
      ...memoryResult,
      objects: backup.objects.length,
      customTypes: backup.customTypes.length,
      attachments: backup.attachments.length,
    };
  } catch (err) {
    // PostgreSQL itself rolls back transactionally. Revert the browser stores
    // too if the server rejects the merge. Already-verified attachment files
    // may remain as harmless unreferenced blobs after a later failure.
    setCustomTypes(previousTypes);
    await objectRepository.replaceAll(previousObjects);
    saveSettings({ workspaceName: previousWorkspaceName });
    throw err;
  }
}

export async function buildChronicleBackup() {
  const settings = getSettings();
  const createdAt = new Date().toISOString();
  const [objects, memory] = await Promise.all([objectRepository.list(), exportMemory()]);
  const customTypes = getCustomTypes();
  const attachments = await exportAttachments(objects, settings.apiUrl);

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
    },
    workspace: { name: settings.workspaceName || "Personal workspace" },
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
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
