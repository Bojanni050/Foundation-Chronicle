const KEY = "chronicle_settings";

// Each AI feature gets its own model — cheaper/faster for simple jobs
// (tagging), stronger for nuanced ones (Persona's soort/gevoelig judgment).
export const AI_FUNCTIONS = [
  { key: "tagging", label: "Auto-tagging", hint: "Suggests 2-4 tags per note — fast, cheap, short JSON output." },
  { key: "weave", label: "AI Weave", hint: "Picks related objects from a candidate list — needs decent reasoning." },
  { key: "pulse", label: "AI Pulse", hint: "Writes a short digest of your stack — benefits from a more capable model." },
  { key: "persona", label: "Persona detection", hint: "Judges soort/gevoelig per kenmerk — needs careful, nuanced reasoning." },
  { key: "chat", label: "AI Chat / Gaia", hint: "Model used for interactive conversations with Gaia, Chronicle's AI assistant." },
  { key: "specialist", label: "AI Specialists (default)", hint: "Default model for specialist sub-agents Gaia delegates to — overridable per specialist." },
];

const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

const DEFAULTS = {
  openrouterKey: "",
  // Optional local model (e.g. llama-server via a Tauri sidecar, GPU-accelerated).
  // Off by default — OpenRouter remains the default path for every AI function.
  useLocalModel: false,
  localModelUrl: "http://127.0.0.1:8080/v1",
  // How often (in exchanges) a live Gaia conversation gets scanned for
  // persona kenmerken while still open, in addition to the normal full-scan
  // detection elsewhere. 0 disables live consolidation.
  gaiaConsolidateEveryNTurns: 5,
  // Route Gaia's own chat turn through her self-contained Hermes backend
  // (gives her terminal/file tool access via Hermes) instead of calling
  // OpenRouter directly. Off by default — opt-in, unlike the old removed
  // chatEndpoint/chatKey mechanism. URL/key are fetched fresh from
  // Chronicle's own backend (GET /api/settings/gaia-hermes-config) at call
  // time, never cached here, so a stale value can't silently persist.
  gaiaHermesEnabled: false,
  // Native Windows UI Automation activity capture (desktop app only, no-op
  // in a plain browser). Off by default — opt-in, same as every other
  // capture/routing feature here. uiaCaptureText is a separate flag so
  // app/window tracking can be on without also reading visible text of UI
  // elements, mirroring PureMemory's own base-capture-vs-clipboard-content
  // split for the same defense-in-depth reason.
  uiaCaptureEnabled: false,
  uiaCaptureText: false,
  models: {
    tagging: DEFAULT_MODEL,
    weave: DEFAULT_MODEL,
    pulse: DEFAULT_MODEL,
    persona: DEFAULT_MODEL,
    chat: DEFAULT_MODEL,
    specialist: DEFAULT_MODEL,
  },
  apiUrl: "http://127.0.0.1:4577",
  apiToken: "",
  workspaceName: "Personal workspace",
};

// Fields removed from the settings shape entirely (the old self-hosted-Hermes
// custom-endpoint concept) — actively stripped from anyone's already-saved
// localStorage below, not just omitted from DEFAULTS, so stale values (e.g.
// a leftover Tailscale/VPN address) can't silently keep being used.
const REMOVED_KEYS = ["chatEndpoint", "chatKey"];

export function getSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    for (const k of REMOVED_KEYS) delete parsed[k];
    return { ...DEFAULTS, ...parsed, models: { ...DEFAULTS.models, ...(parsed.models || {}) } };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch) {
  const current = getSettings();
  const next = { ...current, ...patch, models: { ...current.models, ...(patch.models || {}) } };
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("chronicle-settings-changed"));
  return next;
}
