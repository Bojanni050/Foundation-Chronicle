import { useEffect, useState } from "react";
import { Check, Fingerprint, Loader2, X, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AIService } from "@/services/AIService";
import {
  bevestigKenmerk,
  detectPersonaKenmerken,
  getPersonaState,
  magGebruiktWorden,
  verwerpKenmerk,
  fetchAlleKenmerken,
  reflectHindsight,
} from "@/services/personaSync";

export function PersonaDialog({ open, onOpenChange }) {
  const [state, setState] = useState(null); // { instelling, kenmerken } | null
  const [allTraits, setAllTraits] = useState([]); // all traits including rejected/replaced
  const [tab, setTab] = useState("current"); // current | history
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = async () => {
    const [stateData, allData] = await Promise.all([
      getPersonaState(),
      fetchAlleKenmerken().catch(() => [])
    ]);
    setState(stateData);
    setAllTraits(allData);
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  const detect = async () => {
    setNote("");
    if (!AIService.isConfigured()) {
      setNote("Add an OpenRouter key in Settings first.");
      return;
    }
    setBusy(true);
    const n = await detectPersonaKenmerken();
    setBusy(false);
    if (n === -1) setNote("Local server not reachable — run `npm run server`.");
    else if (n === 0) setNote("Nothing new to learn from your recent objects.");
    else setNote(`Processed ${n} candidate${n === 1 ? "" : "s"}.`);
    await load();
  };

  const runHindsight = async () => {
    setNote("");
    if (!AIService.isConfigured()) {
      setNote("Add an OpenRouter key in Settings first.");
      return;
    }
    setBusy(true);
    const res = await reflectHindsight();
    setBusy(false);
    if (!res.success) {
      if (res.reason === "NO_TEMPORAL_DATA") {
        setNote("No notes have temporal details (occurredAt, temporalText) to reflect on.");
      } else {
        setNote(`Hindsight reflection failed: ${res.reason}`);
      }
    } else {
      setNote(`Reflected temporal evolution! Applied ${res.reflectionsCount} changes.`);
      await load();
    }
  };

  const confirm = async (id) => {
    await bevestigKenmerk(id);
    await load();
  };

  const reject = async (id) => {
    await verwerpKenmerk(id);
    await load();
  };

  const kenmerken = state?.kenmerken || [];
  const currentTraits = kenmerken.filter((k) => !k.valid_to);
  
  const historyTraits = allTraits.filter(
    (k) => k.valid_to || (k.status === "rejected" && k.vervangen_door)
  );
  // Sort history newest first
  historyTraits.sort((a, b) => {
    const timeA = a.valid_to || a.created_at || "";
    const timeB = b.valid_to || b.created_at || "";
    return timeB.localeCompare(timeA);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="persona-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl">
            <Fingerprint className="w-5 h-5 text-primary" /> Persona
          </DialogTitle>
        </DialogHeader>

        {state !== null && (
          <div className="flex border-b border-border mb-3.5">
            <button
              onClick={() => setTab("current")}
              className={`flex-1 pb-2 text-center text-sm font-medium transition-colors border-b-2 ${
                tab === "current"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-ink"
              }`}
            >
              Current Persona
            </button>
            <button
              onClick={() => setTab("history")}
              className={`flex-1 pb-2 text-center text-sm font-medium transition-colors border-b-2 ${
                tab === "history"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-ink"
              }`}
            >
              Hindsight History
            </button>
          </div>
        )}

        <div className="space-y-4 pt-1">
          {state === null ? (
            <p className="text-sm text-muted-foreground">
              Can't reach the local server — run <code>npm run server</code> to use Persona.
            </p>
          ) : tab === "current" ? (
            currentTraits.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Nothing learned yet. Detect patterns to get started.
              </p>
            ) : (
              <ul className="space-y-2.5 max-h-80 overflow-y-auto" data-testid="persona-list">
                {currentTraits.map((k) => {
                  const usable = magGebruiktWorden(k, state.instelling);
                  const needsConfirm = k.gevoelig && !usable && k.zekerheid >= state.instelling.confidence_threshold;
                  return (
                    <li
                      key={k.id}
                      data-testid={`persona-item-${k.id}`}
                      className="rounded-lg bg-accent/50 px-3 py-2.5 text-sm text-ink font-sans"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span>
                          <span
                            data-testid={`persona-soort-${k.id}`}
                            className="mr-1.5 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary font-medium"
                          >
                            {k.soort}
                          </span>
                          {k.kenmerk}
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
                          {k.zekerheid}%
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground/70">
                          {k.status}
                          {usable && k.status !== "confirmed" ? " · above threshold" : ""}
                          {needsConfirm ? " · sensitive, needs confirmation" : ""} ·{" "}
                          {k.bron_object_ids.length} source{k.bron_object_ids.length === 1 ? "" : "s"}
                        </span>
                        {k.status !== "confirmed" && (
                          <div className="flex shrink-0 gap-1">
                            <button
                              onClick={() => confirm(k.id)}
                              data-testid={`persona-confirm-${k.id}`}
                              title="Confirm"
                              className="rounded p-1 text-primary hover:bg-primary/10"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => reject(k.id)}
                              data-testid={`persona-reject-${k.id}`}
                              title="Reject"
                              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          ) : (
            historyTraits.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No temporal changes or historical traits recorded yet.
              </p>
            ) : (
              <ul className="space-y-2.5 max-h-80 overflow-y-auto">
                {historyTraits.map((k) => {
                  const start = k.valid_from ? new Date(k.valid_from).toLocaleDateString() : new Date(k.created_at).toLocaleDateString();
                  const end = k.valid_to ? new Date(k.valid_to).toLocaleDateString() : "Present";
                  const timeStr = k.temporal_text ? `${k.temporal_text} (${start} - ${end})` : `${start} - ${end}`;
                  const survivor = allTraits.find((x) => x.id === k.vervangen_door);

                  return (
                    <li
                      key={k.id}
                      className="rounded-lg bg-accent/30 border border-border/40 px-3 py-2.5 text-sm text-ink font-sans"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-ink/80 line-through">
                          <span className="mr-1.5 rounded bg-muted/65 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                            {k.soort}
                          </span>
                          {k.kenmerk}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground/80 font-medium">
                        Timeframe: {timeStr}
                      </div>
                      {k.vervangen_door && (
                        <div className="mt-2 border-t border-border/60 pt-1.5 text-[11px] text-muted-foreground/90">
                          <div className="font-semibold text-primary/80">Replaced by:</div>
                          <div className="italic mt-0.5">"{survivor ? survivor.kenmerk : "Newer trait"}"</div>
                          {k.verwerp_reden && (
                            <div className="mt-1 text-[10px] text-muted-foreground/70">
                              Reason: {k.verwerp_reden}
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )
          )}

          {note && (
            <p className="text-[11px] text-primary/80" data-testid="persona-note">
              {note}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={detect}
              disabled={busy}
              data-testid="detect-persona-btn"
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-ink py-2.5 text-sm font-medium text-background hover:bg-ink/90 disabled:opacity-40 transition-colors"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
              Detect patterns
            </button>
            <button
              onClick={runHindsight}
              disabled={busy}
              data-testid="reflect-hindsight-btn"
              className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium text-ink hover:bg-accent/40 disabled:opacity-40 transition-colors"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Reflect Hindsight
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
