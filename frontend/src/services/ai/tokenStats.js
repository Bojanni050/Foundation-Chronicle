// Token usage stats, persisted in localStorage by core.js's chatMessage(),
// plus small top-level utilities (isConfigured, test) that don't belong to
// any single AI feature.
import { getSettings } from "@/lib/settings";
import { chat } from "./core";

export function isConfigured() {
  const { openrouterKey, useLocalModel } = getSettings();
  return !!openrouterKey || !!useLocalModel;
}

export async function test(model) {
  const out = await chat(
    [{ role: "user", content: "Reply with the single word: ok" }],
    { max_tokens: 5 },
    model,
    "test"
  );
  return { ok: true, sample: out.trim() };
}

const STATS_KEY = "chronicle_token_stats";

export function getTokenStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    return raw ? JSON.parse(raw) : { totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0, calls: [] };
  } catch {
    return { totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0, calls: [] };
  }
}

export function clearTokenStats() {
  localStorage.removeItem(STATS_KEY);
}
