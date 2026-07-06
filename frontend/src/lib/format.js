export function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

export function relTime(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return fmtDate(iso);
}

// Content-first: an entry's shown title is its title, or — if none — the first
// non-empty line of its content.
export function displayTitle(obj) {
  const t = (obj?.title || "").trim();
  if (t && t !== "Untitled") return t;
  const firstLine = (obj?.content || "").split(/\r?\n/).find((l) => l.trim());
  if (firstLine) return firstLine.trim().slice(0, 80);
  return "Untitled";
}

const PROVIDER_LABEL = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini" };

// Human-readable source of an entry (e.g. "You", "Claude", "Imported").
export function sourceLabel(obj) {
  if (obj?.sourceProvider) return PROVIDER_LABEL[obj.sourceProvider] || obj.sourceProvider;
  switch (obj?.source) {
    case "import": return "Imported";
    case "extension": return "Extension";
    default: return "You";
  }
}

// Options for the editable Source control.
export const SOURCE_OPTIONS = [
  { value: "you", label: "You · live typed", source: "manual", provider: null },
  { value: "claude", label: "Claude", source: "import", provider: "claude" },
  { value: "chatgpt", label: "ChatGPT", source: "import", provider: "chatgpt" },
  { value: "gemini", label: "Gemini", source: "import", provider: "gemini" },
  { value: "extension", label: "Browser extension", source: "extension", provider: null },
  { value: "import", label: "Imported (other)", source: "import", provider: null },
];

export function sourceValue(obj) {
  if (obj?.sourceProvider) return obj.sourceProvider;
  if (obj?.source === "import") return "import";
  if (obj?.source === "extension") return "extension";
  return "you";
}
