const KEY = "chronicle_settings";

const DEFAULTS = {
  openrouterKey: "",
  model: "deepseek/deepseek-v4-flash",
  apiUrl: "http://127.0.0.1:4577",
  apiToken: "",
  workspaceName: "Personal workspace",
};

export function getSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("chronicle-settings-changed"));
  return next;
}

export const MODEL_SUGGESTIONS = [
  "deepseek/deepseek-v4-flash",
  "anthropic/claude-haiku-4-5",
  "openai/gpt-4o-mini",
];
