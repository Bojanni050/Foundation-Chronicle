import { AIService } from "./AIService";

// Capture engine (this process, server/index.js) and memory engine
// (server/memory-process/index.js) each self-sample their own CPU/memory
// (server/resourceUsage.js) and expose it on a plain GET — capture directly,
// memory proxied through the existing /api/memory prefix. Either can be
// null if that process is down; the caller decides how to render that.
export async function fetchResourceUsage() {
  const { getSettings } = await import("../lib/settings");
  const { apiUrl } = getSettings();
  if (!apiUrl) return { capture: null, memory: null };

  const [capture, memory] = await Promise.all([
    fetch(`${apiUrl}/api/settings/resource-usage`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(`${apiUrl}/api/memory/resource-usage`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  return { capture, memory };
}

export async function fetchSystemStatus() {
  const result = {
    backend: "offline",
    db: "offline",
    embeddings: "offline",
    memorySchema: "unknown",
    llm: "offline",
    tauri: "offline",
    tauriMessage: "",
    llmMessage: ""
  };

  // 1. Check Backend
  try {
    const { getSettings } = await import("../lib/settings");
    const { apiUrl } = getSettings();
    if (apiUrl) {
      const res = await fetch(`${apiUrl}/api/settings/status`);
      if (res.ok) {
        const data = await res.json();
        result.backend = "ok";
        result.db = data.db;
        result.embeddings = data.embeddings;
        result.memorySchema = data.memorySchema || "unknown";
      }
    }
  } catch (err) {
    console.warn("Backend status fetch failed", err);
  }

  // 2. Check LLM Config
  try {
    const { getSettings } = await import("../lib/settings");
    const config = getSettings();
    if (!config.openrouterKey && !config.localLLMEndpoint) {
      result.llm = "missing_key";
      result.llmMessage = "No OpenRouter key or Local Endpoint configured";
    } else {
      result.llm = "ok";
      result.llmMessage = config.openrouterKey ? "OpenRouter Configured" : "Local Model Configured";
    }
  } catch (err) {
    result.llm = "offline";
    result.llmMessage = err.message;
  }

  // 3. Check Tauri Native Capture
  if (window.__TAURI__) {
    try {
      const { getSettings } = await import("../lib/settings");
      const { uiaCaptureEnabled } = getSettings();
      if (uiaCaptureEnabled) {
        result.tauri = "ok";
        result.tauriMessage = "Running";
      } else {
        result.tauri = "disabled";
        result.tauriMessage = "Disabled in Settings";
      }
    } catch (e) {
      result.tauri = "error";
    }
  } else {
    result.tauri = "unavailable";
    result.tauriMessage = "Browser Mode (Tauri inactive)";
  }

  return result;
}
