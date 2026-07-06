import { useEffect, useState, useCallback } from "react";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { objectRepository } from "@/repositories";
import { typeMeta } from "@/lib/objectTypes";
import { relTime } from "@/lib/format";

export function SearchDialog({ open, onOpenChange, onOpenObject }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);

  const run = useCallback(async (query) => {
    const r = await objectRepository.search(query);
    setResults(r.slice(0, 30));
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      run("");
    }
  }, [open, run]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0" data-testid="search-dialog">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Search your objects by title, content, or tags</DialogDescription>
        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            autoFocus
            data-testid="search-input"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              run(e.target.value);
            }}
            placeholder="Search titles, content, tags…"
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-muted-foreground/60 focus:outline-none"
          />
          <kbd className="text-[11px] text-muted-foreground/50">esc</kbd>
        </div>
        <div className="max-h-[380px] overflow-y-auto p-2 no-scrollbar">
          {results.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground" data-testid="search-empty">
              {q ? "No matches found." : "Start typing to search your stack."}
            </p>
          ) : (
            results.map((o) => {
              const meta = typeMeta(o.type);
              const Icon = meta.icon;
              return (
                <button
                  key={o.id}
                  data-testid={`search-result-${o.id}`}
                  onClick={() => onOpenObject(o.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-accent/60 transition-colors"
                >
                  <Icon className="w-4 h-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{o.title || "Untitled"}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {meta.singular} · {relTime(o.updatedAt)}
                      {(o.tags || []).length ? " · " + o.tags.map((t) => "#" + t).join(" ") : ""}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
