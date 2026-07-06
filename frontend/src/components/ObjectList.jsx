import { Plus } from "lucide-react";
import { typeMeta } from "@/lib/objectTypes";
import { relTime, displayTitle } from "@/lib/format";
import { ListEmpty } from "@/components/EmptyState";

const providerDot = {
  claude: "bg-orange-400",
  chatgpt: "bg-emerald-400",
  gemini: "bg-blue-400",
};

function ListItem({ obj, active, onClick }) {
  const meta = typeMeta(obj.type);
  const Icon = meta.icon;
  const heading = displayTitle(obj);
  // content-first preview: skip the line already used as the title
  const body = (obj.content || "").replace(/\s+/g, " ").trim();
  const preview = body && body.slice(0, 80) === heading ? body.slice(heading.length).trim() : body;
  return (
    <button
      onClick={onClick}
      data-testid={`list-item-${obj.id}`}
      className={`group w-full rounded-xl border px-3.5 py-3 text-left transition-all ${
        active
          ? "border-primary/40 bg-card shadow-[0_1px_0_hsl(34_30%_88%)]"
          : "border-transparent hover:border-border hover:bg-card/60"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[15px] font-medium text-ink">{heading}</p>
          {obj.sourceProvider && (
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${providerDot[obj.sourceProvider] || "bg-muted-foreground/40"}`} />
          )}
        </div>
        {preview && (
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground line-clamp-2">{preview}</p>
        )}
        <div className="mt-2 flex items-center gap-2">
          <Icon className="w-3 h-3 shrink-0 text-muted-foreground/60 group-hover:text-primary/70" strokeWidth={1.75} />
          <span className="text-[11px] text-muted-foreground/70">{relTime(obj.updatedAt)}</span>
          {(obj.tags || []).slice(0, 2).map((t) => (
            <span key={t} className="text-[11px] text-primary/70">#{t}</span>
          ))}
        </div>
      </div>
    </button>
  );
}

export function ObjectList({ view, objects, selectedId, onSelect, onNew }) {
  const title = view === "all" ? "Everything" : typeMeta(view).label;
  const count = objects.length;

  return (
    <div className="flex h-full w-[320px] shrink-0 flex-col border-r border-border">
      <div className="flex items-start justify-between px-5 pt-5 pb-3">
        <div>
          <h1 className="font-serif text-2xl text-ink" data-testid="list-title">{title}</h1>
          <p className="mt-0.5 text-xs text-muted-foreground" data-testid="list-count">
            {count} object{count === 1 ? "" : "s"}
          </p>
        </div>
        <button
          onClick={onNew}
          data-testid="list-new-btn"
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-background hover:bg-ink/90 transition-colors"
        >
          <Plus className="w-4 h-4" strokeWidth={2} />
          New
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-4 no-scrollbar">
        {count === 0 ? (
          <ListEmpty />
        ) : (
          <div className="space-y-1">
            {objects.map((o) => (
              <ListItem
                key={o.id}
                obj={o}
                active={o.id === selectedId}
                onClick={() => onSelect(o.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
