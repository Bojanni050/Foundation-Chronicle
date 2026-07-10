import { useEffect, useState } from "react";
import { Bot, Check, Loader2, Sparkles, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AIService } from "@/services/AIService";
import { AI_FUNCTIONS } from "@/lib/settings";
import {
  confirmSpecialist,
  detectSpecialisten,
  getSpecialistState,
  rejectSpecialist,
  updateSpecialist,
} from "@/services/specialistSync";

export function SpecialistDialog({ open, onOpenChange }) {
  const [state, setState] = useState(null); // { specialisten } | null
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = async () => setState(await getSpecialistState());

  useEffect(() => {
    if (open) load();
  }, [open]);

  const detect = async () => {
    setNote("");
    setBusy(true);
    const n = await detectSpecialisten();
    setBusy(false);
    if (n === -1) setNote("Local server not reachable — run `npm run server`.");
    else if (n === 0) setNote("No topic recurs often enough yet — keep working, patterns build up over time.");
    else setNote(`Found ${n} candidate specialist${n === 1 ? "" : "s"}.`);
    await load();
  };

  const confirm = async (row) => {
    if (!AIService.isConfigured()) {
      setNote("Add an OpenRouter key in Settings first — needed to write the specialist's system prompt.");
      return;
    }
    setBusy(true);
    try {
      await confirmSpecialist(row);
    } catch (err) {
      setNote(`Couldn't generate a system prompt: ${err.message}`);
    }
    setBusy(false);
    await load();
  };

  const reject = async (id) => {
    await rejectSpecialist(id);
    await load();
  };

  const savePrompt = async (id, systemPrompt) => {
    await updateSpecialist(id, { systemPrompt });
    await load();
  };

  const saveModel = async (id, model) => {
    await updateSpecialist(id, { model });
    await load();
  };

  const specialisten = state?.specialisten || [];
  const observations = specialisten.filter((s) => s.status === "observation");
  const confirmed = specialisten.filter((s) => s.status === "confirmed");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="specialist-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl">
            <Bot className="w-5 h-5 text-primary" /> AI Specialists
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground">
            Gaia can delegate focused questions to a specialist instead of loading everything into its own
            context. A specialist only becomes active once you confirm it.
          </p>
        </DialogHeader>

        <div className="space-y-4 pt-1 max-h-[60vh] overflow-y-auto no-scrollbar">
          {state === null ? (
            <p className="text-sm text-muted-foreground">
              Can't reach the local server — run <code>npm run server</code> to use Specialists.
            </p>
          ) : (
            <>
              {observations.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    Awaiting confirmation
                  </p>
                  <ul className="space-y-2">
                    {observations.map((s) => (
                      <li
                        key={s.id}
                        data-testid={`specialist-observation-${s.id}`}
                        className="rounded-lg bg-accent/50 px-3 py-2.5 text-sm text-ink"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span>
                            You often work with <span className="font-medium">{s.onderwerp}</span> —
                            become a specialist in it?
                          </span>
                          <div className="flex shrink-0 gap-1">
                            <button
                              onClick={() => confirm(s)}
                              disabled={busy}
                              title="Confirm"
                              className="rounded p-1 text-primary hover:bg-primary/10 disabled:opacity-40"
                            >
                              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => reject(s.id)}
                              disabled={busy}
                              title="Reject"
                              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground/70">
                          {s.bron_object_ids.length} source{s.bron_object_ids.length === 1 ? "" : "s"}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  Active specialists
                </p>
                {confirmed.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    None yet. Detect patterns to find candidates.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {confirmed.map((s) => (
                      <li
                        key={s.id}
                        data-testid={`specialist-${s.id}`}
                        className="rounded-lg border border-border/60 px-3 py-2.5 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-ink">{s.onderwerp}</span>
                          <select
                            value={s.model || ""}
                            onChange={(e) => saveModel(s.id, e.target.value)}
                            data-testid={`specialist-model-${s.id}`}
                            className="rounded border border-border bg-card/50 px-1.5 py-1 text-[11px] text-ink focus:outline-none focus:ring-1 focus:ring-primary/40"
                          >
                            <option value="">Default ({AI_FUNCTIONS.find((f) => f.key === "specialist")?.hint ? "Settings" : "default"})</option>
                            <option value="anthropic/claude-3-5-sonnet">Claude 3.5 Sonnet</option>
                            <option value="deepseek/deepseek-v4-flash">DeepSeek v4 Flash</option>
                            <option value="openai/gpt-4o-mini">GPT-4o mini</option>
                          </select>
                        </div>
                        <textarea
                          defaultValue={s.system_prompt || ""}
                          onBlur={(e) => savePrompt(s.id, e.target.value)}
                          rows={3}
                          data-testid={`specialist-prompt-${s.id}`}
                          className="w-full resize-none rounded-lg border border-border bg-card/50 p-2 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary/40"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {note && <p className="text-[11px] text-primary/80">{note}</p>}

          <button
            onClick={detect}
            disabled={busy}
            data-testid="detect-specialist-btn"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink py-2.5 text-sm font-medium text-background hover:bg-ink/90 disabled:opacity-40 transition-colors"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Detect patterns
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
