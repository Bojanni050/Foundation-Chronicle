import { useMemo, useState } from "react";
import { Waypoints, Sparkles, Loader2, RefreshCw } from "lucide-react";
import { findRelatedLocal } from "@/services/weave";
import { AIService } from "@/services/AIService";
import { typeMeta } from "@/lib/objectTypes";

export function AIWeave({ selectedObject, allObjects, onOpen, onRefreshInbox, syncing }) {
  const [aiIds, setAiIds] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const related = useMemo(() => {
    if (!selectedObject) return [];
    const base = findRelatedLocal(selectedObject, allObjects);
    if (!aiIds) return base;
    // reorder: AI-picked first
    const map = new Map(base.map((r) => [r.id, r]));
    const ordered = [];
    for (const id of aiIds) {
      const obj = allObjects.find((o) => o.id === id && id !== selectedObject.id);
      if (obj) ordered.push(map.get(id) || { id, object: obj, reason: "AI suggested", score: 1 });
    }
    for (const r of base) if (!aiIds.includes(r.id)) ordered.push(r);
    return ordered;
  }, [selectedObject, allObjects, aiIds]);

  const enhance = async () => {
    if (!selectedObject) return;
    setNote("");
    setBusy(true);
    try {
      const ids = await AIService.findRelated(selectedObject, allObjects);
      setAiIds(ids);
    } catch {
      setNote("AI weave unavailable — showing tag & text matches.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="flex h-full w-[336px] shrink-0 flex-col border-l border-border bg-background/40">
      <div className="flex items-center justify-between px-5 pt-5 pb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" strokeWidth={2} />
          <h2 className="font-serif text-lg text-ink">AI weave</h2>
        </div>
        <button
          onClick={onRefreshInbox}
          data-testid="inbox-refresh-btn"
          title="Pull queued items from extension"
          className="text-muted-foreground hover:text-primary transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex items-center gap-1.5 px-5 pb-3">
        <Waypoints className="w-3.5 h-3.5 text-muted-foreground" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Related objects
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 no-scrollbar">
        {!selectedObject ? (
          <p className="px-1 text-sm text-muted-foreground" data-testid="weave-empty">
            Open an object to see what it connects to.
          </p>
        ) : related.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground" data-testid="weave-none">
            No connections yet. Add shared tags or write more to weave threads.
          </p>
        ) : (
          <div className="space-y-1.5" data-testid="weave-list">
            {related.map((r) => {
              const meta = typeMeta(r.object.type);
              const Icon = meta.icon;
              return (
                <button
                  key={r.id}
                  onClick={() => onOpen(r.id)}
                  data-testid={`weave-item-${r.id}`}
                  className="group w-full rounded-lg border border-transparent px-3 py-2.5 text-left hover:border-border hover:bg-card/60 transition-all"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary/80" strokeWidth={1.75} />
                    <span className="truncate text-sm text-ink">{r.object.title || "Untitled"}</span>
                  </div>
                  <p className="mt-0.5 pl-5.5 text-[11px] text-primary/70">{r.reason}</p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selectedObject && (
        <div className="border-t border-border p-4">
          {note && <p className="mb-2 text-[11px] text-primary/80" data-testid="weave-note">{note}</p>}
          <button
            onClick={enhance}
            disabled={busy}
            data-testid="weave-enhance-btn"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            Enhance with AI
          </button>
        </div>
      )}
    </aside>
  );
}
