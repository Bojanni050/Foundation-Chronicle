import { getSettings } from "@/lib/settings";

/**
 * Poll for pending "Gaia wants to talk about this" topics (contradictions
 * the background consolidator won't silently merge, notable new facts).
 * Returns -1 if the local server is unreachable, otherwise the (possibly
 * empty) array of unresolved topics — same -1/found convention as
 * pollInbox() (inboxSync.js).
 */
export async function checkGaiaProactiveTopics() {
  const { apiUrl } = getSettings();
  if (!apiUrl) return -1;
  try {
    const res = await fetch(`${apiUrl}/api/persona/proactive-topics`);
    if (!res.ok) return -1;
    const topics = await res.json();
    return Array.isArray(topics) ? topics : -1;
  } catch {
    return -1; // local server unreachable (expected in hosted preview)
  }
}

/** Marks a topic resolved once it's been shown to the user. */
export async function resolveGaiaProactiveTopic(id) {
  const { apiUrl } = getSettings();
  if (!apiUrl) return null;
  try {
    const res = await fetch(`${apiUrl}/api/persona/proactive-topics/${id}/resolve`, { method: "POST" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
