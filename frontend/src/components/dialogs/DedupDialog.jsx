import { useEffect, useMemo, useState } from "react";
import { Copy, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { objectRepository } from "@/repositories";
import { toast } from "sonner";

// Two grouping strategies, in order of confidence:
// 1. Identical content (same contentHash) — the clearest signal, e.g. the
//    pre-atomic-claim race that let a browser tab and the Tauri app each
//    create their own object from the same inbox item.
// 2. Same conversation, different content (same providerConversationId) —
//    lower confidence: could be a genuine re-import that grew the chat, not
//    necessarily junk. Shown separately so it's never conflated with the
//    exact-match group.
function groupDuplicates(objects) {
  const byHash = new Map();
  for (const o of objects) {
    if (!o.contentHash) continue;
    if (!byHash.has(o.contentHash)) byHash.set(o.contentHash, []);
    byHash.get(o.contentHash).push(o);
  }
  const exactGroups = [...byHash.values()].filter((g) => g.length > 1);

  const inExactGroup = new Set(exactGroups.flat().map((o) => o.id));
  const byConv = new Map();
  for (const o of objects) {
    if (!o.providerConversationId || inExactGroup.has(o.id)) continue;
    if (!byConv.has(o.providerConversationId)) byConv.set(o.providerConversationId, []);
    byConv.get(o.providerConversationId).push(o);
  }
  const versionGroups = [...byConv.values()].filter((g) => g.length > 1);

  return { exactGroups, versionGroups };
}

function newestFirst(group) {
  return [...group].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export function DedupDialog({ open, onOpenChange }) {
  const [objects, setObjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toDelete, setToDelete] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    objectRepository.list().then((objs) => {
      setObjects(objs);
      setLoading(false);
    });
  }, [open]);

  const { exactGroups, versionGroups } = useMemo(() => groupDuplicates(objects), [objects]);

  // Default selection is a starting point only, never an action: everything
  // except the most recently updated item per group is pre-checked, but
  // nothing is deleted until the person explicitly confirms below.
  useEffect(() => {
    const initial = new Set();
    for (const group of [...exactGroups, ...versionGroups]) {
      const [, ...rest] = newestFirst(group);
      rest.forEach((o) => initial.add(o.id));
    }
    setToDelete(initial);
  }, [exactGroups, versionGroups]);

  const toggle = (id) => {
    setToDelete((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = async () => {
    if (toDelete.size === 0) return;
    setDeleting(true);
    let deleted = 0;
    for (const id of toDelete) {
      try {
        await objectRepository.delete(id);
        deleted++;
      } catch (err) {
        console.error("[Dedup] Could not delete", id, err.message);
      }
    }
    setDeleting(false);
    toast.success(`${deleted} duplicate${deleted === 1 ? "" : "s"} deleted`);
    const objs = await objectRepository.list();
    setObjects(objs);
  };

  const totalGroups = exactGroups.length + versionGroups.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" data-testid="dedup-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl">
            <Copy className="w-5 h-5 text-primary" /> Find duplicates
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : totalGroups === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No duplicates found.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground pb-2">
              Nothing is deleted until you click "Delete selected" below. The most recently
              updated entry in each group starts unchecked — adjust before confirming.
            </p>
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {exactGroups.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 pb-1">
                    Identical content ({exactGroups.length})
                  </p>
                  {exactGroups.map((group, i) => (
                    <DupGroup key={i} group={newestFirst(group)} toDelete={toDelete} onToggle={toggle} />
                  ))}
                </div>
              )}
              {versionGroups.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 pb-1">
                    Same conversation, different versions ({versionGroups.length})
                  </p>
                  {versionGroups.map((group, i) => (
                    <DupGroup key={i} group={newestFirst(group)} toDelete={toDelete} onToggle={toggle} />
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between pt-3 border-t border-border">
              <p className="text-xs text-muted-foreground">{toDelete.size} selected for deletion</p>
              <button
                onClick={handleDelete}
                disabled={deleting || toDelete.size === 0}
                data-testid="dedup-delete-btn"
                className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" strokeWidth={2} />
                Delete selected
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DupGroup({ group, toDelete, onToggle }) {
  return (
    <div className="mb-3 rounded-lg border border-border p-2.5">
      {group.map((o, idx) => (
        <label key={o.id} className="flex items-center gap-2.5 py-1 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={toDelete.has(o.id)}
            onChange={() => onToggle(o.id)}
            data-testid={`dedup-check-${o.id}`}
          />
          <span className="flex-1 truncate">
            {o.title || "(untitled)"}
            {idx === 0 && <span className="text-[10px] text-primary/70 ml-1">(newest — kept by default)</span>}
          </span>
          <span className="text-xs text-muted-foreground/70 shrink-0">
            {(o.updatedAt || "").slice(0, 10)}
          </span>
        </label>
      ))}
    </div>
  );
}
