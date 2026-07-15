import { useEffect, useMemo, useState } from "react";
import { Waypoints, Sparkles, Loader2, RefreshCw, PanelRightClose, BrainCircuit } from "lucide-react";
import { findRelatedLocal } from "@/services/weave";
import { AIService } from "@/services/AIService";
import { getAssumptionsUsed, getPersonaState } from "@/services/personaSync";
import { getSettings } from "@/lib/settings";
import { typeMeta } from "@/lib/objectTypes";
import { displayTitle } from "@/lib/format";

export function AIWeave({ selectedObject, allObjects, onOpen, onRefreshInbox, syncing, onCollapse }) {
  const [aiIds, setAiIds] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [linkedKenmerken, setLinkedKenmerken] = useState([]);
  const [extracting, setExtracting] = useState(false);
  const [extractNote, setExtractNote] = useState("");

  // Kenmerken (both persona claims and "algemeen" facts — same table,
  // distinguished by categorie) live in Postgres, not IndexedDB — fetched
  // separately whenever the selection changes.
  useEffect(() => {
    if (!selectedObject) {
      setLinkedKenmerken([]);
      return;
    }
    let cancelled = false;
    getPersonaState().then((state) => {
      if (cancelled || !state) return;
      setLinkedKenmerken(
        state.kenmerken.filter((k) => (k.bron_object_ids || []).includes(selectedObject.id))
      );
    });
    return () => { cancelled = true; };
  }, [selectedObject]);

  const linkedPersonaTraits = useMemo(
    () => linkedKenmerken.filter((k) => k.categorie !== "algemeen"),
    [linkedKenmerken]
  );
  const linkedAlgemeneFeiten = useMemo(
    () => linkedKenmerken.filter((k) => k.categorie === "algemeen"),
    [linkedKenmerken]
  );

  // Same categorie-routing as detectPersonaKenmerken()'s background scan —
  // both persona claims and general facts/concepts go through the same
  // persona_kenmerk observation → confirm/reject flow, just tagged with a
  // different categorie. On-demand only (a button, not automatic) — an LLM
  // call every time an entry is opened would be wasteful.
  const extractKnowledge = async () => {
    if (!selectedObject || !AIService.isConfigured()) return;
    setExtracting(true);
    setExtractNote("");
    try {
      const { apiUrl } = getSettings();
      const rejectedRes = await fetch(`${apiUrl}/api/persona/kenmerken?status=rejected`);
      const rejected = rejectedRes.ok ? await rejectedRes.json() : [];
      const candidates = await AIService.suggestPersonaKenmerken(rejected.slice(0, 20), [selectedObject]);

      let personaCount = 0;
      let kennisCount = 0;
      for (const c of candidates) {
        if (!c?.kenmerk || !c?.bronObjectId) continue;
        const isAlgemeen = c.categorie === "algemeen";
        await fetch(`${apiUrl}/api/persona/kenmerken`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kenmerk: c.kenmerk,
            bronObjectId: c.bronObjectId,
            soort: isAlgemeen ? null : c.soort,
            gevoelig: isAlgemeen ? false : c.gevoelig,
            categorie: isAlgemeen ? "algemeen" : undefined,
          }),
        });
        if (isAlgemeen) kennisCount++;
        else personaCount++;
      }
      setExtractNote(
        personaCount || kennisCount
          ? `Found ${personaCount} about you, ${kennisCount} general.`
          : "Nothing stood out in this entry."
      );
      // Refresh the linked-kenmerken list to reflect what was just found.
      const state = await getPersonaState();
      if (state) {
        setLinkedKenmerken(state.kenmerken.filter((k) => (k.bron_object_ids || []).includes(selectedObject.id)));
      }
    } catch (err) {
      setExtractNote("Extraction failed — check your AI settings.");
    } finally {
      setExtracting(false);
    }
  };

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
      const assumptions = await getAssumptionsUsed().catch(() => []);
      const traits = assumptions.map((a) => a.kenmerk);
      const candidates = allObjects.filter((o) => o.id !== selectedObject.id);
      const ids = await AIService.findRelated(selectedObject, candidates, traits);
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
        <div className="flex items-center gap-1.5">
          <button
            onClick={onRefreshInbox}
            data-testid="inbox-refresh-btn"
            title="Pull queued items from extension"
            className="text-muted-foreground hover:text-primary transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={onCollapse}
            data-testid="weave-collapse-btn"
            title="Hide AI weave"
            className="text-muted-foreground hover:text-ink transition-colors"
          >
            <PanelRightClose className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-5 pb-3">
        <Waypoints className="w-3.5 h-3.5 text-muted-foreground" />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Related entries
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 no-scrollbar">
        {!selectedObject ? (
          <p className="px-1 text-sm text-muted-foreground" data-testid="weave-empty">
            Open an entry to see what it connects to.
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
                    <span className="truncate text-sm text-ink">{displayTitle(r.object)}</span>
                  </div>
                  <p className="mt-0.5 pl-5.5 text-[11px] text-primary/70">{r.reason}</p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Extracted knowledge — persona claims and general facts/concepts,
          both pending confirmation until reviewed in the Persona dialog.
          On-demand extraction, not automatic per view. */}
      {selectedObject && (
        <div className="border-t border-border px-4 pt-3 pb-1">
          <div className="flex items-center gap-1.5 pb-2">
            <BrainCircuit className="w-3.5 h-3.5 text-muted-foreground" />
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Extracted knowledge
            </p>
          </div>
          {linkedKenmerken.length === 0 ? (
            <p className="px-1 pb-2 text-[11px] text-muted-foreground/70">Nothing extracted from this entry yet.</p>
          ) : (
            <div className="space-y-1.5 pb-2 max-h-40 overflow-y-auto no-scrollbar">
              {linkedPersonaTraits.map((k) => (
                <div key={k.id} className="rounded-lg bg-accent/30 px-2.5 py-1.5 text-xs text-ink">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mr-1.5">over jou</span>
                  {k.kenmerk}
                  {k.status !== "confirmed" && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground/60">· wacht op bevestiging</span>
                  )}
                </div>
              ))}
              {linkedAlgemeneFeiten.map((k) => (
                <div key={k.id} className="rounded-lg bg-accent/30 px-2.5 py-1.5 text-xs text-ink">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60 mr-1.5">algemeen</span>
                  {k.kenmerk}
                  {k.status !== "confirmed" && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground/60">· wacht op bevestiging</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {extractNote && <p className="pb-2 text-[11px] text-primary/80">{extractNote}</p>}
          <button
            onClick={extractKnowledge}
            disabled={extracting}
            data-testid="extract-knowledge-btn"
            className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors disabled:opacity-40"
          >
            {extracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BrainCircuit className="w-3.5 h-3.5" />}
            Extract knowledge from this entry
          </button>
        </div>
      )}

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
