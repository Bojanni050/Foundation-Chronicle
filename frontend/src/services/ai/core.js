// Core chat plumbing shared by every AI-service module: the actual fetch to
// the model endpoint (OpenRouter, local model, or a custom endpoint like
// Gaia's own Hermes gateway), token-stats tracking, and the small JSON-array
// extraction helper several callers rely on.
import { getSettings } from "@/lib/settings";

// Returns the full assistant message (content + tool_calls, if any). `chat()`
// below wraps this for callers that only care about the text.
//
// If a specific customEndpoint is passed (e.g. Gaia's own Hermes endpoint, or
// a specialist's override), that always wins. Otherwise, if the person has
// opted into "use local model" in Settings, every call transparently routes
// to their local llama-server sidecar instead of OpenRouter — same call
// shape, no API key needed, fully optional and off by default.
export async function chatMessage(messages, extra = {}, model, context = "unknown", customEndpoint = null, customKey = null, extraHeaders = null) {
  const { openrouterKey, models, useLocalModel, localModelUrl } = getSettings();

  let endpoint;
  let activeKey;
  if (customEndpoint) {
    endpoint = `${customEndpoint.replace(/\/+$/, "")}/chat/completions`;
    activeKey = customKey || openrouterKey;
    if (!activeKey) throw new Error("NO_KEY");
  } else if (useLocalModel) {
    endpoint = `${(localModelUrl || "http://127.0.0.1:8080/v1").replace(/\/+$/, "")}/chat/completions`;
    activeKey = "local"; // llama-server doesn't check this, but the header still needs a value
  } else {
    endpoint = "https://openrouter.ai/api/v1/chat/completions";
    activeKey = openrouterKey;
    if (!activeKey) throw new Error("NO_KEY");
  }
  const activeModel = model || models.tagging;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${activeKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin,
      "X-Title": "Chronicle",
      ...extraHeaders,
    },
    body: JSON.stringify({ model: activeModel, messages, ...extra }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`AI_ERROR ${res.status} ${t.slice(0, 120)}`);
  }
  const data = await res.json();

  // Track stats
  try {
    const usage = data.usage;
    if (usage) {
      const promptTokens = usage.prompt_tokens || 0;
      const completionTokens = usage.completion_tokens || 0;

      // Estimate prices based on cached list in local storage
      let promptPrice = 0.07;
      let completionPrice = 0.21;

      const { getCachedOpenRouterModels } = await import("../openrouterModels");
      const { models: cachedList } = getCachedOpenRouterModels();
      const matchedModel = cachedList.find((m) => m.id === activeModel);
      if (matchedModel) {
        promptPrice = matchedModel.promptPer1M || 0;
        completionPrice = matchedModel.completionPer1M || 0;
      }

      const cost = (promptTokens * promptPrice + completionTokens * completionPrice) / 1000000;

      const STATS_KEY = "chronicle_token_stats";
      let stats = {
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalCost: 0,
        calls: [],
      };

      const raw = localStorage.getItem(STATS_KEY);
      if (raw) {
        try {
          stats = JSON.parse(raw);
        } catch {}
      }

      stats.totalPromptTokens = (stats.totalPromptTokens || 0) + promptTokens;
      stats.totalCompletionTokens = (stats.totalCompletionTokens || 0) + completionTokens;
      stats.totalCost = (stats.totalCost || 0) + cost;

      const callRecord = {
        timestamp: new Date().toISOString(),
        context,
        model: activeModel,
        promptTokens,
        completionTokens,
        cost,
      };

      stats.calls = [callRecord, ...(stats.calls || [])].slice(0, 50);
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    }
  } catch (err) {
    console.error("Failed to track token statistics:", err.message);
  }

  return data.choices?.[0]?.message || {};
}

export async function chat(messages, extra = {}, model, context = "unknown", customEndpoint = null, customKey = null) {
  const message = await chatMessage(messages, extra, model, context, customEndpoint, customKey);
  return message.content || "";
}

export function firstJsonArray(text) {
  // Strip <think>...</think> blocks from reasoning models
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  
  // Try to find a markdown json block first
  const blockMatch = cleaned.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (blockMatch) {
    try { return JSON.parse(blockMatch[1]); } catch {}
  }
  
  // Fallback to finding the first array-like structure
  // Using a non-greedy match that stops at the last closing bracket of the structure
  let start = cleaned.indexOf('[');
  if (start === -1) return null;
  
  let end = cleaned.lastIndexOf(']');
  if (end === -1 || end < start) return null;
  
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}
