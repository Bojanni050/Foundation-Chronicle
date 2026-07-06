import { useState } from "react";
import { X, Sparkles, Loader2 } from "lucide-react";

export function TagEditor({ tags = [], onChange, onSuggest, aiNote }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const add = (raw) => {
    const clean = raw.toLowerCase().replace(/^#/, "").trim();
    if (clean && !tags.includes(clean)) onChange([...tags, clean]);
    setInput("");
  };

  const remove = (t) => onChange(tags.filter((x) => x !== t));

  const suggest = async () => {
    if (!onSuggest) return;
    setBusy(true);
    try {
      const suggested = await onSuggest();
      const merged = [...tags];
      for (const s of suggested) if (!merged.includes(s)) merged.push(s);
      onChange(merged);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="tag-editor">
      <div className="flex flex-wrap items-center gap-2">
        {tags.map((t) => (
          <span
            key={t}
            data-testid={`tag-chip-${t}`}
            className="group inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground"
          >
            #{t}
            <button
              onClick={() => remove(t)}
              className="opacity-40 hover:opacity-100 transition-opacity"
              data-testid={`tag-remove-${t}`}
              aria-label={`Remove ${t}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          data-testid="tag-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(input);
            } else if (e.key === "Backspace" && !input && tags.length) {
              remove(tags[tags.length - 1]);
            }
          }}
          placeholder="add tag…"
          className="min-w-[80px] flex-1 bg-transparent text-xs text-ink placeholder:text-muted-foreground/60 focus:outline-none py-1"
        />
        {onSuggest && (
          <button
            onClick={suggest}
            disabled={busy}
            data-testid="suggest-tags-btn"
            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Suggest
          </button>
        )}
      </div>
      {aiNote && (
        <p className="mt-2 text-xs text-primary/80" data-testid="tag-ai-note">
          {aiNote}
        </p>
      )}
    </div>
  );
}
