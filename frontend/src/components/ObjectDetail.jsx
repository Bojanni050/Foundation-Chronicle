import { useEffect, useRef, useState, useCallback } from "react";
import { Trash2, Check, Loader2, Link2, ExternalLink, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { objectRepository } from "@/repositories";
import { AIService, keywordTags } from "@/services/AIService";
import { typeMeta } from "@/lib/objectTypes";
import { useTypes } from "@/hooks/useTypes";
import { fmtDate, SOURCE_OPTIONS, sourceValue } from "@/lib/format";
import { TagEditor } from "@/components/TagEditor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PROVIDER_LABEL = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini" };

function formatForInput(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  } catch {
    return "";
  }
}

export function ObjectDetail({ object, onSaved, onDelete }) {
  const allTypes = useTypes();
  const [title, setTitle] = useState(object.title);
  const [content, setContent] = useState(object.content);
  const [tags, setTags] = useState(object.tags || []);
  const [type, setType] = useState(object.type);
  const [source, setSource] = useState(object.source);
  const [provider, setProvider] = useState(object.sourceProvider);
  const [occurredAt, setOccurredAt] = useState(formatForInput(object.occurredAt));
  const [validFrom, setValidFrom] = useState(formatForInput(object.validFrom));
  const [validTo, setValidTo] = useState(formatForInput(object.validTo));
  const [temporalText, setTemporalText] = useState(object.temporalText || "");
  const [showTemporal, setShowTemporal] = useState(false);
  const [saveState, setSaveState] = useState("saved"); // saved | saving
  const [aiNote, setAiNote] = useState("");
  const timer = useRef(null);
  const idRef = useRef(object.id);
  const pending = useRef({});
  const titleRef = useRef(null);
  const contentAreaRef = useRef(null);

  // reseed when a different object opens
  useEffect(() => {
    idRef.current = object.id;
    pending.current = {};
    setTitle(object.title);
    setContent(object.content);
    setTags(object.tags || []);
    setType(object.type);
    setSource(object.source);
    setProvider(object.sourceProvider);
    setOccurredAt(formatForInput(object.occurredAt));
    setValidFrom(formatForInput(object.validFrom));
    setValidTo(formatForInput(object.validTo));
    setTemporalText(object.temporalText || "");
    setShowTemporal(!!(object.occurredAt || object.validFrom || object.validTo || object.temporalText));
    setSaveState("saved");
    setAiNote("");
    // content-first capture: a fresh, empty entry drops the cursor straight
    // into the writing surface — no type to pick first.
    if (!object.title && !object.content) {
      requestAnimationFrame(() => titleRef.current?.focus());
    }
  }, [object.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = useCallback(() => {
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const patch = pending.current;
      pending.current = {};
      const updated = await objectRepository.update(idRef.current, patch);
      setSaveState("saved");
      if (updated) onSaved(updated);
    }, 500);
  }, [onSaved]);

  const change = (field, value, setter) => {
    setter(value);
    pending.current = { ...pending.current, [field]: value };
    persist();
  };

  const handleDateChange = (field, value, setter) => {
    setter(value);
    let isoValue = null;
    if (value) {
      try {
        const d = new Date(value);
        if (!isNaN(d.getTime())) {
          isoValue = d.toISOString();
        }
      } catch (err) {
        console.error("Invalid date selected", err);
      }
    }
    pending.current = { ...pending.current, [field]: isoValue };
    persist();
  };

  const suggest = async () => {
    setAiNote("");
    const text = `${title}\n${content}`.trim();
    if (AIService.isConfigured()) {
      try {
        return await AIService.suggestTags(text);
      } catch {
        setAiNote("AI tagging unavailable — check your OpenRouter settings. Used keywords instead.");
      }
    }
    return keywordTags(text);
  };

  const meta = typeMeta(type);

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-10 pt-10 pb-6 rise-in" data-testid="object-detail">
      {/* content-first: title + body are the surface */}
      <input
        ref={titleRef}
        data-testid="detail-title-input"
        value={title}
        onChange={(e) => change("title", e.target.value, setTitle)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); contentAreaRef.current?.focus(); }
        }}
        placeholder="Untitled"
        className="w-full shrink-0 bg-transparent font-serif text-4xl leading-tight text-ink placeholder:text-muted-foreground/30 focus:outline-none"
      />

      <textarea
        ref={contentAreaRef}
        data-testid="detail-content-input"
        value={content}
        onChange={(e) => change("content", e.target.value, setContent)}
        placeholder="Start writing…"
        className="mt-4 flex-1 w-full resize-none bg-transparent text-base leading-relaxed text-ink/90 placeholder:text-muted-foreground/40 focus:outline-none no-scrollbar whitespace-pre-wrap"
      />

      {/* subtle metadata bar — everything about classifying comes AFTER writing */}
      <div className="mt-4 shrink-0 border-t border-border pt-3">
        <div className="mb-2.5">
          <TagEditor tags={tags} onChange={(t) => change("tags", t, setTags)} onSuggest={suggest} aiNote={aiNote} />
        </div>

        {/* Collapsible Temporal Metadata */}
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setShowTemporal(!showTemporal)}
            data-testid="toggle-temporal-btn"
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-ink hover:bg-accent/40 transition-all"
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Time context</span>
            {showTemporal ? (
              <ChevronUp className="w-3 h-3 opacity-60" />
            ) : (
              <ChevronDown className="w-3 h-3 opacity-60" />
            )}
          </button>
          
          {showTemporal && (
            <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-border bg-accent/15 p-3.5 fade-in" data-testid="temporal-panel">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Occurred At</label>
                <input
                  type="datetime-local"
                  data-testid="temporal-occurred-input"
                  value={occurredAt}
                  onChange={(e) => handleDateChange("occurredAt", e.target.value, setOccurredAt)}
                  className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary/40"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Temporal Description</label>
                <input
                  type="text"
                  placeholder="e.g. last winter, early June..."
                  data-testid="temporal-text-input"
                  value={temporalText}
                  onChange={(e) => change("temporalText", e.target.value || null, setTemporalText)}
                  className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-ink placeholder:text-muted-foreground/35 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary/40"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Valid From</label>
                <input
                  type="datetime-local"
                  data-testid="temporal-valid-from-input"
                  value={validFrom}
                  onChange={(e) => handleDateChange("validFrom", e.target.value, setValidFrom)}
                  className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary/40"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Valid To</label>
                <input
                  type="datetime-local"
                  data-testid="temporal-valid-to-input"
                  value={validTo}
                  onChange={(e) => handleDateChange("validTo", e.target.value, setValidTo)}
                  className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary/40"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Select
            value={allTypes.some((t) => t.key === type) ? type : "untyped"}
            onValueChange={(v) => change("type", v === "untyped" ? null : v, setType)}
          >
            <SelectTrigger className="h-7 w-auto gap-1.5 border-none bg-transparent px-1.5 text-xs text-muted-foreground hover:text-ink hover:bg-accent/50 rounded-md" data-testid="type-select">
              <meta.icon className="w-3.5 h-3.5 text-primary/80" strokeWidth={1.75} />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="untyped" data-testid="type-option-untyped">Untyped</SelectItem>
              {allTypes.map((t) => (
                <SelectItem key={t.key} value={t.key} data-testid={`type-option-${t.key}`}>
                  {t.singular}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="text-muted-foreground/40">·</span>
          <span className="capitalize">{object.source}</span>
          {object.sourceProvider && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] text-accent-foreground">
              {PROVIDER_LABEL[object.sourceProvider] || object.sourceProvider}
            </span>
          )}
          {object.sourceUrl && (
            <a href={object.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-primary" data-testid="source-url-link">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <span className="text-muted-foreground/40">·</span>
          <span className="text-muted-foreground/70">{fmtDate(object.createdAt)}</span>
          {object.occurredAt && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-muted-foreground/70" title="Occurred at">
                Occurred {fmtDate(object.occurredAt)}
              </span>
            </>
          )}
          {object.temporalText && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-muted-foreground/70 italic" title="Temporal description">
                “{object.temporalText}”
              </span>
            </>
          )}
          {(object.links || []).length > 0 && (
            <span className="flex items-center gap-1"><Link2 className="w-3.5 h-3.5" />{object.links.length}</span>
          )}

          <span className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1 text-[11px]" data-testid="save-indicator">
              {saveState === "saving" ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
              ) : (
                <><Check className="w-3 h-3 text-primary" /> Saved</>
              )}
            </span>
            <button
              onClick={() => onDelete(object.id)}
              data-testid="delete-object-btn"
              className="hover:text-destructive transition-colors"
              aria-label="Delete entry"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
