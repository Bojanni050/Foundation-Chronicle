const KEY = "chronicle_settings";

// Each AI feature gets its own model — cheaper/faster for simple jobs
// (tagging), stronger for nuanced ones (Persona's soort/gevoelig judgment).
export const AI_FUNCTIONS = [
  { key: "tagging", label: "Auto-tagging", hint: "Suggests 2-4 tags per note — fast, cheap, short JSON output." },
  { key: "weave", label: "AI Weave", hint: "Picks related objects from a candidate list — needs decent reasoning." },
  { key: "pulse", label: "AI Pulse", hint: "Writes a short digest of your stack — benefits from a more capable model." },
  { key: "persona", label: "Persona detection", hint: "Judges soort/gevoelig per kenmerk — needs careful, nuanced reasoning." },
  { key: "hypothesis", label: "Hypothesis detection", hint: "Proposes testable hypotheses and evidence from your archive — needs careful, nuanced reasoning." },
];

const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

const DEFAULTS = {
  openrouterKey: "",
  // Optional local model (e.g. llama-server via a Tauri sidecar, GPU-accelerated).
  // Off by default — OpenRouter remains the default path for every AI function.
  useLocalModel: false,
  localModelUrl: "http://127.0.0.1:8080/v1",
  // Native Windows UI Automation activity capture (desktop app only, no-op
  // in a plain browser). Off by default — opt-in, same as every other
  // capture/routing feature here. uiaCaptureText is a separate flag so
  // app/window tracking can be on without also reading visible text of UI
  // elements, mirroring PureMemory's own base-capture-vs-clipboard-content
  // split for the same defense-in-depth reason.
  uiaCaptureEnabled: false,
  uiaCaptureText: false,
  uiaCaptureOcrFallback: false,
  // Native Windows clipboard capture (desktop app only). Off by default —
  // opt-in, same as UIA capture, and kept as its own flag rather than
  // folded into uiaCaptureText: clipboard content is a materially more
  // sensitive source (password managers, one-time codes) than on-screen
  // text, so it should never turn on as a side effect of another toggle.
  clipboardCaptureEnabled: false,
  models: {
    tagging: DEFAULT_MODEL,
    weave: DEFAULT_MODEL,
    pulse: DEFAULT_MODEL,
    persona: DEFAULT_MODEL,
    hypothesis: DEFAULT_MODEL,
  },
  apiUrl: "http://127.0.0.1:4577",
  apiToken: "",
  workspaceName: "Personal workspace",
};

// Fields removed from the settings shape entirely (the old self-hosted-Hermes
// custom-endpoint concept, and Gaia/Hermes itself) — actively stripped from
// anyone's already-saved localStorage below, not just omitted from DEFAULTS,
// so stale values (e.g. a leftover Tailscale/VPN address) can't silently
// keep being used.
const REMOVED_KEYS = ["chatEndpoint", "chatKey", "gaiaConsolidateEveryNTurns", "gaiaHermesEnabled"];

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
