import { useEffect, useState } from "react";
import { Check, Fingerprint, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AIService } from "@/services/AIService";
import {
  bevestigKenmerk,
  detectPersonaKenmerken,
  getPersonaState,
  magGebruiktWorden,
  verwerpKenmerk,
} from "@/services/personaSync";

export function PersonaDialog({ open, onOpenChange }) {
  const [state, setState] = useState(null); // { instelling, kenmerken } | null
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = async () => setState(await getPersonaState());

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

  const confirm = async (id) => {
    await bevestigKenmerk(id);
    await load();
  };

  const reject = async (id) => {
    await verwerpKenmerk(id);
    await load();
  };

  const kenmerken = state?.kenmerken || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="persona-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl">
            <Fingerprint className="w-5 h-5 text-primary" /> Persona
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {state === null ? (
            <p className="text-sm text-muted-foreground">
              Can't reach the local server — run <code>npm run server</code> to use Persona.
            </p>
          ) : kenmerken.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing learned yet. Detect patterns to get started.
            </p>
          ) : (
            <ul className="space-y-2.5 max-h-80 overflow-y-auto" data-testid="persona-list">
              {kenmerken.map((k) => {
                const usable = magGebruiktWorden(k, state.instelling);
                const needsConfirm = k.gevoelig && !usable && k.zekerheid >= state.instelling.confidence_threshold;
                return (
                <li
                  key={k.id}
                  data-testid={`persona-item-${k.id}`}
                  className="rounded-lg bg-accent/50 px-3 py-2.5 text-sm text-ink"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span>
                      <span
                        data-testid={`persona-soort-${k.id}`}
                        className="mr-1.5 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary"
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
          )}

          {note && (
            <p className="text-[11px] text-primary/80" data-testid="persona-note">
              {note}
            </p>
          )}

          <button
            onClick={detect}
            disabled={busy}
            data-testid="detect-persona-btn"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink py-2.5 text-sm font-medium text-background hover:bg-ink/90 disabled:opacity-40 transition-colors"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
            Detect patterns
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
