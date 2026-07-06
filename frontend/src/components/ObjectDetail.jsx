import { useEffect, useRef, useState, useCallback } from "react";
import { Trash2, Check, Loader2, Link2, ExternalLink } from "lucide-react";
import { objectRepository } from "@/repositories";
import { AIService, keywordTags } from "@/services/AIService";
import { typeMeta, OBJECT_TYPES } from "@/lib/objectTypes";
import { fmtDate } from "@/lib/format";
import { TagEditor } from "@/components/TagEditor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const providerLabel = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini" };

export function ObjectDetail({ object, onSaved, onDelete }) {
  const [title, setTitle] = useState(object.title);
  const [content, setContent] = useState(object.content);
  const [tags, setTags] = useState(object.tags || []);
  const [type, setType] = useState(object.type);
  const [saveState, setSaveState] = useState("saved"); // saved | saving
  const [aiNote, setAiNote] = useState("");
  const timer = useRef(null);
  const idRef = useRef(object.id);

  // reseed when a different object opens
  useEffect(() => {
    idRef.current = object.id;
    setTitle(object.title);
    setContent(object.content);
    setTags(object.tags || []);
    setType(object.type);
    setSaveState("saved");
    setAiNote("");
  }, [object.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = useCallback((patch) => {
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const updated = await objectRepository.update(idRef.current, patch);
      setSaveState("saved");
      if (updated) onSaved(updated);
    }, 500);
  }, [onSaved]);

  const change = (field, value, setter) => {
    setter(value);
    persist({ title, content, tags, type, [field]: value });
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
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-10 py-8 rise-in" data-testid="object-detail">
      {/* meta row */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Select
            value={type}
            onValueChange={(v) => change("type", v, setType)}
          >
            <SelectTrigger className="h-8 w-auto gap-1.5 border-border bg-transparent text-xs" data-testid="type-select">
              <meta.icon className="w-3.5 h-3.5 text-primary" strokeWidth={1.75} />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OBJECT_TYPES.map((t) => (
                <SelectItem key={t.key} value={t.key} data-testid={`type-option-${t.key}`}>
                  {t.singular}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground capitalize">{object.source}</span>
          {object.sourceProvider && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] text-accent-foreground">
              {providerLabel[object.sourceProvider] || object.sourceProvider}
            </span>
          )}
          {object.sourceUrl && (
            <a href={object.sourceUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-primary" data-testid="source-url-link">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground" data-testid="save-indicator">
            {saveState === "saving" ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
            ) : (
              <><Check className="w-3 h-3 text-primary" /> Saved</>
            )}
          </span>
          <button
            onClick={() => onDelete(object.id)}
            data-testid="delete-object-btn"
            className="text-muted-foreground hover:text-destructive transition-colors"
            aria-label="Delete object"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <input
        data-testid="detail-title-input"
        value={title}
        onChange={(e) => change("title", e.target.value, setTitle)}
        placeholder="Untitled"
        className="w-full bg-transparent font-serif text-3xl text-ink placeholder:text-muted-foreground/40 focus:outline-none"
      />

      <p className="mt-1 mb-4 text-xs text-muted-foreground">
        Created {fmtDate(object.createdAt)}
      </p>

      <div className="mb-5 rounded-xl border border-border bg-card/50 px-3.5 py-3">
        <TagEditor tags={tags} onChange={(t) => change("tags", t, setTags)} onSuggest={suggest} aiNote={aiNote} />
      </div>

      <textarea
        data-testid="detail-content-input"
        value={content}
        onChange={(e) => change("content", e.target.value, setContent)}
        placeholder="Start writing…"
        className="flex-1 w-full resize-none bg-transparent text-[15px] leading-relaxed text-ink placeholder:text-muted-foreground/40 focus:outline-none no-scrollbar whitespace-pre-wrap"
      />

      {(object.links || []).length > 0 && (
        <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link2 className="w-3.5 h-3.5" /> {object.links.length} linked
        </div>
      )}
    </div>
  );
}
