import { useCallback, useEffect, useMemo, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { Waypoints } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { objectRepository } from "@/repositories";
import { findRelatedLocal } from "@/services/weave";
import { fetchAlleKenmerken } from "@/services/personaSync";
import { typeMeta } from "@/lib/objectTypes";

const TYPE_COLORS = {
  note: "#c76b4a",
  person: "#7a9e7e",
  task: "#c9a24b",
  idea: "#8a7fc7",
  book: "#4a90a4",
  project: "#b56a8f",
  meeting: "#5a8fb5",
  dailyLog: "#a4874a",
  chat: "#6ba38a",
};
const UNTYPED_COLOR = "#9c9186";
const KENMERK_FEIT_COLOR = "#3f7a68";
const KENMERK_PATROON_COLOR = "#c76b4a";
const KENMERK_REJECTED_COLOR = "#b3aca2";

function buildGraph(objects, kenmerken) {
  const nodes = [];
  const links = [];
  const objectIds = new Set(objects.map((o) => o.id));

  for (const o of objects) {
    nodes.push({
      id: o.id,
      kind: "object",
      label: o.title || "(untitled)",
      color: TYPE_COLORS[o.type] || UNTYPED_COLOR,
      val: 3,
    });
  }

  // Explicit links between objects.
  const seenPairs = new Set();
  for (const o of objects) {
    for (const targetId of o.links || []) {
      if (!objectIds.has(targetId)) continue;
      const key = [o.id, targetId].sort().join("::");
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      links.push({ source: o.id, target: targetId, kind: "link" });
    }
  }

  // Inferred (AI Weave-style) relatedness — same local scoring as the app's
  // own weave panel, thresholded so the graph doesn't drown in weak edges.
  // We use a Map cache to avoid re-tokenizing the same text thousands of times.
  const weaveCache = new Map();
  for (const o of objects) {
    for (const rel of findRelatedLocal(o, objects, 4, weaveCache)) {
      if (rel.score < 0.15) continue;
      const key = [o.id, rel.id].sort().join("::");
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      links.push({ source: o.id, target: rel.id, kind: "weave" });
    }
  }

  for (const k of kenmerken) {
    nodes.push({
      id: k.id,
      kind: "kenmerk",
      label: k.kenmerk,
      soort: k.soort,
      status: k.status,
      color:
        k.status === "rejected"
          ? KENMERK_REJECTED_COLOR
          : k.soort === "feit"
            ? KENMERK_FEIT_COLOR
            : KENMERK_PATROON_COLOR,
      val: 2,
    });
    for (const bronId of k.bron_object_ids || []) {
      if (!objectIds.has(bronId)) continue;
      links.push({ source: k.id, target: bronId, kind: "bron" });
    }
    if (k.vervangen_door) {
      links.push({ source: k.id, target: k.vervangen_door, kind: "merge" });
    }
  }

  return { nodes, links };
}

const LINK_STYLE = {
  link: { color: "rgba(60,50,40,0.35)", width: 1.4, dash: null },
  weave: { color: "rgba(60,50,40,0.15)", width: 0.8, dash: [1, 2] },
  bron: { color: "rgba(199,107,74,0.35)", width: 0.8, dash: null },
  merge: { color: "rgba(179,172,162,0.9)", width: 1.2, dash: [3, 2] },
};

export function GraphDialog({ open, onOpenChange, onOpenObject }) {
  const [objects, setObjects] = useState([]);
  const [kenmerken, setKenmerken] = useState([]);
  const [loading, setLoading] = useState(false);
  // Callback ref instead of useRef+effect: DialogContent renders into a Radix
  // portal, so the container DOM node isn't guaranteed to exist yet on the
  // same effect pass that reacts to `open` — a callback ref fires exactly
  // when the node actually mounts/unmounts, side-stepping that race.
  const [containerEl, setContainerEl] = useState(null);
  const containerRef = useCallback((el) => setContainerEl(el), []);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([objectRepository.list(), fetchAlleKenmerken()]).then(([objs, ks]) => {
      setObjects(objs);
      setKenmerken(ks);
      setLoading(false);
    });
  }, [open]);

  useEffect(() => {
    if (!containerEl) return;
    const update = () => setSize({ width: containerEl.clientWidth, height: containerEl.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(containerEl);
    return () => ro.disconnect();
  }, [containerEl]);

  const graphData = useMemo(() => buildGraph(objects, kenmerken), [objects, kenmerken]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[95vw] w-[95vw] h-[90vh] flex flex-col overflow-hidden"
        data-testid="graph-dialog"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl">
            <Waypoints className="w-5 h-5 text-primary" /> Knowledge graph
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pb-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: TYPE_COLORS.note }} /> objects (color = type)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: KENMERK_PATROON_COLOR }} /> kenmerk (patroon)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: KENMERK_FEIT_COLOR }} /> kenmerk (feit)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: KENMERK_REJECTED_COLOR }} /> merged away
          </span>
        </div>

        <div ref={containerRef} className="min-h-0 flex-1 rounded-lg border border-border bg-card/30" data-testid="graph-canvas-container">
          {loading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : size.width > 0 ? (
            <ForceGraph2D
              graphData={graphData}
              width={size.width}
              height={size.height}
              nodeLabel={(n) => n.label}
              nodeColor={(n) => n.color}
              nodeVal={(n) => n.val}
              nodeRelSize={3}
              linkColor={(l) => LINK_STYLE[l.kind]?.color || "rgba(0,0,0,0.2)"}
              linkWidth={(l) => LINK_STYLE[l.kind]?.width || 1}
              linkLineDash={(l) => LINK_STYLE[l.kind]?.dash || null}
              linkDirectionalArrowLength={(l) => (l.kind === "merge" ? 4 : 0)}
              onNodeClick={(n) => {
                if (n.kind === "object" && onOpenObject) {
                  onOpenObject(n.id);
                  onOpenChange(false);
                }
              }}
              cooldownTicks={80}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
