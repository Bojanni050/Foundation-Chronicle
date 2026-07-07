const KEY = "chronicle_settings";

// Each AI feature gets its own model — cheaper/faster for simple jobs
// (tagging), stronger for nuanced ones (Persona's soort/gevoelig judgment).
export const AI_FUNCTIONS = [
  { key: "tagging", label: "Auto-tagging", hint: "Suggests 2-4 tags per note — fast, cheap, short JSON output." },
  { key: "weave", label: "AI Weave", hint: "Picks related objects from a candidate list — needs decent reasoning." },
  { key: "pulse", label: "AI Pulse", hint: "Writes a short digest of your stack — benefits from a more capable model." },
  { key: "persona", label: "Persona detection", hint: "Judges soort/gevoelig per kenmerk — needs careful, nuanced reasoning." },
];

const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";

const DEFAULTS = {
  openrouterKey: "",
  models: {
    tagging: DEFAULT_MODEL,
    weave: DEFAULT_MODEL,
    pulse: DEFAULT_MODEL,
    persona: DEFAULT_MODEL,
  },
  apiUrl: "http://127.0.0.1:4577",
  apiToken: "",
  workspaceName: "Personal workspace",
};

export function getSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
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
