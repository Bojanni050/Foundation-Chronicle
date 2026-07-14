import { useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, Link2, Plus, Search, X } from "lucide-react";
import { typeMeta } from "@/lib/objectTypes";
import { backlinksFor, linkCandidates, normalizeObjectLinks } from "@/services/objectLinks";

function objectLabel(object) {
  return object?.title?.trim() || "Untitled";
}

function ObjectLinkRow({ object, missingId, direction, onOpen, onRemove, locked }) {
  const meta = object ? typeMeta(object.type) : null;
  const Icon = meta?.icon;
  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs ${
        object ? "border-border bg-background" : "border-destructive/30 bg-destructive/5"
      }`}
      data-testid={object ? `object-link-${direction}-${object.id}` : `object-link-missing-${missingId}`}
    >
      {object ? (
        <>
          {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-primary/80" strokeWidth={1.75} />}
          <button
            type="button"
            onClick={() => onOpen(object.id)}
            className="min-w-0 flex-1 truncate text-left text-ink hover:text-primary"
            title={objectLabel(object)}
          >
            {objectLabel(object)}
          </button>
          <span className="shrink-0 text-[10px] text-muted-foreground">{meta?.singular || "Untyped"}</span>
          <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        </>
      ) : (
        <>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-destructive">Missing linked object</p>
            <p className="truncate font-mono text-[10px] text-muted-foreground" title={missingId}>{missingId}</p>
          </div>
        </>
      )}
      {onRemove && !locked && (
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={`Remove link to ${object ? objectLabel(object) : missingId}`}
          data-testid={`remove-object-link-${object?.id || missingId}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function ObjectLinks({ object, allObjects, links, locked, onLinksChange, onOpen }) {
  const [query, setQuery] = useState("");
  const normalizedLinks = useMemo(() => normalizeObjectLinks(links, object.id), [links, object.id]);
  const byId = useMemo(() => new Map(allObjects.map((entry) => [entry.id, entry])), [allObjects]);
  const backlinks = useMemo(() => backlinksFor(allObjects, object.id), [allObjects, object.id]);
  const candidates = useMemo(
    () => linkCandidates(allObjects, { currentId: object.id, linkedIds: normalizedLinks, query }),
    [allObjects, normalizedLinks, object.id, query],
  );

  const addLink = (id) => {
    onLinksChange(normalizeObjectLinks([...normalizedLinks, id], object.id));
    setQuery("");
  };

  const removeLink = (id) => onLinksChange(normalizedLinks.filter((linkedId) => linkedId !== id));

  return (
    <section className="mt-3 shrink-0 rounded-lg border border-border bg-accent/10 p-3" data-testid="object-links-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-medium text-ink">Connections</h3>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {normalizedLinks.length} outgoing · {backlinks.length} backlink{backlinks.length === 1 ? "" : "s"}
        </span>
      </div>

      {!locked && (
        <div className="relative mt-2.5">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search objects to link…"
            className="w-full rounded-md border border-border bg-background py-2 pl-8 pr-3 text-xs text-ink placeholder:text-muted-foreground/60 focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary"
            data-testid="object-link-search"
          />
          {query && candidates.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-border bg-background shadow-lg" data-testid="object-link-candidates">
              {candidates.map((candidate) => {
                const meta = typeMeta(candidate.type);
                const Icon = meta.icon;
                return (
                  <button
                    type="button"
                    key={candidate.id}
                    onClick={() => addLink(candidate.id)}
                    className="flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-accent/40"
                    data-testid={`add-object-link-${candidate.id}`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-primary/80" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate text-ink">{objectLabel(candidate)}</span>
                    <span className="text-[10px] text-muted-foreground">{meta.singular}</span>
                    <Plus className="h-3.5 w-3.5 text-primary" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3">
        <div>
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Links from this object</p>
          <div className="max-h-32 space-y-1.5 overflow-y-auto no-scrollbar" data-testid="outgoing-object-links">
            {normalizedLinks.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-2.5 py-2 text-[11px] text-muted-foreground">No outgoing links.</p>
            ) : normalizedLinks.map((id) => (
              <ObjectLinkRow
                key={id}
                object={byId.get(id)}
                missingId={id}
                direction="outgoing"
                onOpen={onOpen}
                onRemove={() => removeLink(id)}
                locked={locked}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Links to this object</p>
          <div className="max-h-32 space-y-1.5 overflow-y-auto no-scrollbar" data-testid="object-backlinks">
            {backlinks.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-2.5 py-2 text-[11px] text-muted-foreground">No backlinks yet.</p>
            ) : backlinks.map((backlink) => (
              <ObjectLinkRow key={backlink.id} object={backlink} direction="backlink" onOpen={onOpen} locked={locked} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
