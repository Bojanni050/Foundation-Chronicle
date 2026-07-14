import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Trash2, Check, Loader2, Link2, ExternalLink, Clock, ChevronDown, ChevronUp, Lock, Unlock, Eye, Pencil, Paperclip, X, ChevronLeft, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { objectRepository } from "@/repositories";
import { AIService, keywordTags } from "@/services/AIService";
import { typeMeta } from "@/lib/objectTypes";
import { useTypes } from "@/hooks/useTypes";
import { fmtDate, SOURCE_OPTIONS, sourceValue } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { TagEditor } from "@/components/TagEditor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PROVIDER_LABEL = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini" };

// Matches the app's own tokens (ink/primary/accent/border) rather than a
// generic typography plugin, so rendered markdown looks native to Chronicle
// instead of like a foreign "prose" block.
const BASE_MARKDOWN_COMPONENTS = {
  h1: (p) => <h1 className="font-serif text-2xl text-ink mt-5 mb-2 first:mt-0" {...p} />,
  h2: (p) => <h2 className="font-serif text-xl text-ink mt-4 mb-2 first:mt-0" {...p} />,
  h3: (p) => <h3 className="font-serif text-lg text-ink mt-3 mb-1.5 first:mt-0" {...p} />,
  ul: (p) => <ul className="mb-3 ml-5 list-disc space-y-1" {...p} />,
  ol: (p) => <ol className="mb-3 ml-5 list-decimal space-y-1" {...p} />,
  li: (p) => <li {...p} />,
  a: (p) => <a className="text-primary underline underline-offset-2 hover:text-primary/80" target="_blank" rel="noreferrer" {...p} />,
  strong: (p) => <strong className="font-semibold text-ink" {...p} />,
  blockquote: (p) => <blockquote className="mb-3 border-l-2 border-border pl-3 italic text-muted-foreground" {...p} />,
  hr: (p) => <hr className="my-4 border-border" {...p} />,
  table: (p) => <table className="mb-3 w-full border-collapse text-sm" {...p} />,
  th: (p) => <th className="border border-border px-2 py-1 text-left font-semibold" {...p} />,
  td: (p) => <td className="border border-border px-2 py-1" {...p} />,
  // react-markdown always wraps block code in <pre><code>; take over pre so
  // code can decide block vs. inline itself (a single component, one box —
  // no double <pre> nesting) using "does it contain a newline" as the
  // heuristic, since plain ``` fences (no language tag) carry no className.
  pre: ({ children }) => <>{children}</>,
  code: ({ children }) => {
    const text = String(children).replace(/\n$/, "");
    if (text.includes("\n")) {
      return (
        <pre className="mb-3 overflow-x-auto rounded-lg bg-accent/40 p-3 text-[0.85em] text-ink">
          <code>{text}</code>
        </pre>
      );
    }
    return <code className="rounded bg-accent px-1 py-0.5 text-[0.85em] text-ink">{text}</code>;
  },
};

// Used inside a single chat-bubble's own markdown (see the object.turns
// render path below) — just a plain paragraph, no bubble-wrapping, since
// the bubble is already built around it by the caller.
const PLAIN_MARKDOWN_COMPONENTS = {
  ...BASE_MARKDOWN_COMPONENTS,
  p: (p) => <p className="mb-3 last:mb-0 leading-relaxed" {...p} />,
};

// Fallback for chat objects imported before `turns` was persisted on the
// object (or any other content that happens to use the "H: "/"A: " text
// convention) — matches a paragraph's literal prefix to decide if it's a
// chat bubble. Fragile by construction (breaks on a turn starting with a
// heading/code fence/list, and can false-positive on an ordinary note whose
// text happens to start with "A: "), which is exactly why object.turns is
// used instead whenever it's available.
const MARKDOWN_COMPONENTS = {
  ...BASE_MARKDOWN_COMPONENTS,
  p: ({ children, ...props }) => {
    const childArray = Array.isArray(children) ? children : [children];
    const firstChild = childArray[0];

    if (typeof firstChild === 'string') {
      const match = firstChild.match(/^(H|A):\s(.*)/s);
      if (match) {
        const isHuman = match[1] === 'H';
        const newChildren = [match[2], ...childArray.slice(1)];

        return (
          <div className={`mb-4 flex w-full ${isHuman ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[90%] sm:max-w-[85%] rounded-2xl px-4 py-3 ${
              isHuman
                ? 'bg-primary/10 text-ink font-medium'
                : 'bg-accent/40 text-ink font-normal'
            }`}>
              <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${isHuman ? 'text-primary/80' : 'text-muted-foreground/70'}`}>
                {isHuman ? 'Ik' : 'AI'}
              </div>
              <div className="leading-relaxed break-words whitespace-pre-wrap">{newChildren}</div>
            </div>
          </div>
        );
      }
    }
    return <p className="mb-3 last:mb-0 leading-relaxed" {...props}>{children}</p>;
  },
};

// Chat bubble wrapper for a single turn rendered from object.turns — pulled
// out so the structure (role -> alignment/color/label) lives in exactly one
// place instead of being duplicated per turn in the render below.
function ChatBubble({ turn }) {
  const isHuman = turn.role !== "assistant";
  return (
    <div className={`mb-4 flex w-full ${isHuman ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[90%] sm:max-w-[85%] rounded-2xl px-4 py-3 ${isHuman ? "bg-primary/10 text-ink font-medium" : "bg-accent/40 text-ink font-normal"}`}>
        <div className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${isHuman ? "text-primary/80" : "text-muted-foreground/70"}`}>
          {isHuman ? "Ik" : "AI"}
        </div>
        <div className="leading-relaxed break-words">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={PLAIN_MARKDOWN_COMPONENTS}>
            {turn.text || ""}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

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
  const [locked, setLocked] = useState(!!object.locked);
  const [lockBusy, setLockBusy] = useState(false);
  // Driven by actual CONTENT, not title-or-content — a fresh object with
  // only an auto-filled title and no content yet has nothing to preview,
  // and should drop straight into the writing surface rather than opening
  // in preview mode with an empty-looking body.
  const [preview, setPreview] = useState(!!(object.content && object.content.trim()));
  const [lightboxIndex, setLightboxIndex] = useState(null);
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
    setLocked(!!object.locked);
    const isNew = !object.title && !object.content;
    setPreview(!!(object.content && object.content.trim()));
    setLightboxIndex(null);
    // content-first capture: a fresh, empty entry drops the cursor straight
    // into the writing surface — no type to pick first.
    if (isNew) {
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
    if (locked) return; // inputs are also disabled while locked — this is a backstop
    setter(value);
    pending.current = { ...pending.current, [field]: value };
    persist();
  };

  const toggleLock = async () => {
    setLockBusy(true);
    try {
      const updated = await objectRepository.update(object.id, { locked: !locked });
      if (updated) {
        setLocked(updated.locked);
        onSaved(updated);
      }
    } finally {
      setLockBusy(false);
    }
  };

  const handleDateChange = (field, value, setter) => {
    if (locked) return;
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
  const { apiUrl } = getSettings();
  const attachments = object.attachments || [];
  const imageAttachments = attachments.filter((att) => (att.mimeType || "").startsWith("image/"));
  // Structured turns win over the "H: "/"A: " text-prefix convention
  // whenever they're actually there — see MARKDOWN_COMPONENTS' comment for
  // why that convention is fragile. Only chat objects have turns; a note
  // whose content happens to start with "A: " is never affected either way.
  const hasTurns = object.type === "chat" && Array.isArray(object.turns) && object.turns.length > 0;

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-10 pt-10 pb-6 rise-in" data-testid="object-detail">
      {/* content-first: title + body are the surface */}
      <input
        ref={titleRef}
        data-testid="detail-title-input"
        value={title}
        onChange={(e) => change("title", e.target.value, setTitle)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            // Locked objects can't be edited either way (the textarea
            // below is disabled) — dropping out of preview would just land
            // on a body the user can visibly see but can't type into.
            if (locked) return;
            if (preview) {
              setPreview(false);
              requestAnimationFrame(() => contentAreaRef.current?.focus());
            } else {
              contentAreaRef.current?.focus();
            }
          }
        }}
        placeholder="Untitled"
        disabled={locked}
        className="w-full shrink-0 bg-transparent font-serif text-4xl leading-tight text-ink placeholder:text-muted-foreground/30 focus:outline-none disabled:opacity-70 disabled:cursor-not-allowed"
      />

      <div className="relative mt-4 min-h-0 flex-1">
        <button
          onClick={() => setPreview((v) => !v)}
          data-testid="content-preview-toggle"
          className="absolute right-0 top-0 z-10 flex items-center gap-1 rounded-full border border-border bg-background/80 px-2 py-1 text-[11px] text-muted-foreground hover:text-ink hover:bg-accent/50 transition-colors"
          title={preview ? "Edit raw text" : "Preview rendered markdown"}
        >
          {preview ? <Pencil className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          {preview ? "Edit" : "Preview"}
        </button>

        {preview ? (
          <div
            data-testid="detail-content-preview"
            className="h-full w-full overflow-y-auto no-scrollbar pr-16 text-base text-ink/90"
          >
            {hasTurns ? (
              object.turns.map((t, i) => <ChatBubble key={i} turn={t} />)
            ) : content.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                {content}
              </ReactMarkdown>
            ) : (
              <p className="text-muted-foreground/40">Nothing to preview yet.</p>
            )}
          </div>
        ) : (
          <textarea
            ref={contentAreaRef}
            data-testid="detail-content-input"
            value={content}
            onChange={(e) => change("content", e.target.value, setContent)}
            placeholder="Start writing…"
            disabled={locked}
            className="h-full w-full resize-none bg-transparent text-base leading-relaxed text-ink/90 placeholder:text-muted-foreground/40 focus:outline-none no-scrollbar whitespace-pre-wrap disabled:opacity-70 disabled:cursor-not-allowed"
          />
        )}
      </div>

      {attachments.length > 0 && (
        <div className="mt-3 shrink-0 flex flex-wrap gap-2" data-testid="object-attachments">
          {attachments.map((att) => {
            const href = `${apiUrl}${att.url}`;
            const isImage = (att.mimeType || "").startsWith("image/");
            return isImage ? (
              <a
                key={att.id}
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  const idx = imageAttachments.findIndex((img) => img.id === att.id);
                  if (idx !== -1) setLightboxIndex(idx);
                }}
                target="_blank"
                rel="noreferrer"
                title={att.filename}
                data-testid="attachment-image"
                className="block h-20 w-20 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-border bg-accent/20 hover:opacity-80 transition-opacity"
              >
                <img src={href} alt={att.filename} className="h-full w-full object-cover" />
              </a>
            ) : (
              <a
                key={att.id}
                href={href}
                target="_blank"
                rel="noreferrer"
                title={att.filename}
                data-testid="attachment-file"
                className="flex items-center gap-1.5 rounded-full border border-border bg-accent/20 px-2.5 py-1 text-xs text-muted-foreground hover:text-ink hover:bg-accent/40 transition-colors"
              >
                <Paperclip className="w-3 h-3" />
                <span className="max-w-[140px] truncate">{att.filename}</span>
              </a>
            );
          })}
        </div>
      )}

      {/* subtle metadata bar — everything about classifying comes AFTER writing */}
      <div className="mt-4 shrink-0 border-t border-border pt-3">
        <div className="mb-2.5">
          <TagEditor tags={tags} onChange={(t) => change("tags", t, setTags)} onSuggest={suggest} aiNote={aiNote} disabled={locked} />
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
                  disabled={locked}
                  className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary/40 disabled:opacity-60 disabled:cursor-not-allowed"
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
                  disabled={locked}
                  className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-ink placeholder:text-muted-foreground/35 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary/40 disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Valid From</label>
                <input
                  type="datetime-local"
                  data-testid="temporal-valid-from-input"
                  value={validFrom}
                  onChange={(e) => handleDateChange("validFrom", e.target.value, setValidFrom)}
                  disabled={locked}
                  className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary/40 disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Valid To</label>
                <input
                  type="datetime-local"
                  data-testid="temporal-valid-to-input"
                  value={validTo}
                  onChange={(e) => handleDateChange("validTo", e.target.value, setValidTo)}
                  disabled={locked}
                  className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary/40 disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Select
            value={allTypes.some((t) => t.key === type) ? type : "untyped"}
            onValueChange={(v) => change("type", v === "untyped" ? null : v, setType)}
            disabled={locked}
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
              onClick={toggleLock}
              disabled={lockBusy}
              data-testid="lock-toggle-btn"
              className={`transition-colors disabled:opacity-40 ${locked ? "text-primary hover:text-primary/70" : "hover:text-ink"}`}
              aria-label={locked ? "Unlock entry" : "Lock entry"}
              title={locked ? "Locked — click to unlock and edit again" : "Lock this entry so it can't be edited or deleted"}
            >
              {locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
            </button>
            <button
              onClick={() => !locked && onDelete(object.id)}
              disabled={locked}
              data-testid="delete-object-btn"
              className="hover:text-destructive transition-colors disabled:opacity-30 disabled:hover:text-current disabled:cursor-not-allowed"
              aria-label="Delete entry"
              title={locked ? "Unlock this entry before deleting it" : "Delete entry"}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </span>
        </div>
      </div>

      {lightboxIndex !== null && imageAttachments[lightboxIndex] && createPortal(
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm p-4 fade-in"
          onClick={() => setLightboxIndex(null)}
        >
          <div className="absolute top-0 left-0 right-0 flex justify-between items-center p-4 z-10 bg-gradient-to-b from-black/60 to-transparent">
            <div className="text-white/90 text-sm font-medium px-2 drop-shadow-md">
              {imageAttachments[lightboxIndex].filename}
            </div>
            <button
              className="rounded-full bg-black/50 p-2 text-white hover:bg-black/70 transition-colors"
              onClick={() => setLightboxIndex(null)}
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          
          <div className="relative flex-1 w-full flex items-center justify-center min-h-0 py-12">
            {lightboxIndex > 0 && (
              <button
                className="absolute left-4 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 transition-colors"
                onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex - 1); }}
              >
                <ChevronLeft className="w-8 h-8" />
              </button>
            )}

            <img
              src={`${apiUrl}${imageAttachments[lightboxIndex].url}`}
              alt={imageAttachments[lightboxIndex].filename}
              className="max-h-full max-w-full rounded-md object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />

            {lightboxIndex < imageAttachments.length - 1 && (
              <button
                className="absolute right-4 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70 transition-colors"
                onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex + 1); }}
              >
                <ChevronRight className="w-8 h-8" />
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
