const MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";
const CACHE_KEY = "chronicle_openrouter_models";

function toDisplayModel(raw) {
  const promptPer1M = Number(raw.pricing?.prompt || 0) * 1e6;
  const completionPer1M = Number(raw.pricing?.completion || 0) * 1e6;
  const params = raw.supported_parameters || [];
  const capabilities = [
    params.includes("tools") && "tools",
    params.includes("structured_outputs") && "json",
    params.includes("reasoning") && "reasoning",
  ].filter(Boolean);
  return {
    id: raw.id,
    name: raw.name,
    promptPer1M,
    completionPer1M,
    contextLength: raw.context_length,
    capabilities,
  };
}

/** Public endpoint, no API key needed. Excludes non-text-output models (image/audio gen). */
export async function fetchOpenRouterModels() {
  const res = await fetch(MODELS_ENDPOINT);
  if (!res.ok) throw new Error("MODELS_FETCH_ERROR");
  const data = await res.json();
  const models = (data.data || [])
    .filter((m) => (m.architecture?.output_modalities || ["text"]).includes("text"))
    .map(toDisplayModel)
    .sort((a, b) => a.promptPer1M - b.promptPer1M);
  localStorage.setItem(CACHE_KEY, JSON.stringify({ models, fetchedAt: Date.now() }));
  return models;
}

export function getCachedOpenRouterModels() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { models: [], fetchedAt: null };
    return JSON.parse(raw);
  } catch {
    return { models: [], fetchedAt: null };
  }
}

export function formatPrice(per1M) {
  if (per1M === 0) return "free";
  if (per1M < 0.01) return "<$0.01/1M";
  return `$${per1M.toFixed(2)}/1M`;
}
