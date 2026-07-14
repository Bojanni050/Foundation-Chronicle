import { AIService } from "./AIService";

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
