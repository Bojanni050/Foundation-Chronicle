import { getSettings } from "@/lib/settings";
import { objectRepository } from "@/repositories";

/**
 * Pull queued objects from the local API inbox into IndexedDB, then clear
 * the inbox. Returns the number of objects imported. Fails silently if the
 * local server isn't running (expected in hosted preview).
 */
export async function pollInbox() {
  const { apiUrl } = getSettings();
  if (!apiUrl) return 0;
  try {
    const res = await fetch(`${apiUrl}/api/inbox`, { method: "GET" });
    if (!res.ok) return 0;
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) return 0;
    for (const it of items) {
      await objectRepository.create({
        type: "chat",
        title: it.title || "Imported chat",
        content: it.content || "",
        tags: Array.isArray(it.tags) ? it.tags : [],
        source: "extension",
        sourceProvider: it.sourceProvider || null,
        sourceUrl: it.url || null,
      });
    }
    await fetch(`${apiUrl}/api/inbox`, { method: "DELETE" });
    return items.length;
  } catch {
    return 0;
  }
}
