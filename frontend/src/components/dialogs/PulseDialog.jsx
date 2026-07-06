import { useState } from "react";
import { Activity, Loader2, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { objectRepository } from "@/repositories";
import { AIService } from "@/services/AIService";
import { rulePulse } from "@/services/pulse";

export function PulseDialog({ open, onOpenChange }) {
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [aiUsed, setAiUsed] = useState(false);
  const [note, setNote] = useState("");

  const generate = async () => {
    setBusy(true);
    setNote("");
    const objects = await objectRepository.list();
    if (AIService.isConfigured()) {
      try {
        const out = await AIService.generatePulse(objects);
        setItems(out);
        setAiUsed(true);
        setBusy(false);
        return;
      } catch {
        setNote("AI Pulse unavailable — showing a rule-based digest instead.");
      }
    }
    setItems(rulePulse(objects));
    setAiUsed(false);
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="pulse-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl">
            <Activity className="w-5 h-5 text-primary" /> AI Pulse
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {items === null ? (
            <p className="text-sm text-muted-foreground">
              A gentle digest of your stack — recent activity, recurring themes and gentle nudges.
            </p>
          ) : (
            <ul className="space-y-2.5" data-testid="pulse-list">
              {items.map((it, i) => (
                <li
                  key={i}
                  data-testid={`pulse-item-${i}`}
                  className="flex items-start gap-2.5 rounded-lg bg-accent/50 px-3 py-2.5 text-sm text-ink rise-in"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <Sparkles className="mt-0.5 w-3.5 h-3.5 shrink-0 text-primary" />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          )}
          {note && <p className="text-[11px] text-primary/80" data-testid="pulse-note">{note}</p>}
          {items !== null && (
            <p className="text-[11px] text-muted-foreground/70">
              {aiUsed ? "Generated with OpenRouter." : "Rule-based digest (no AI key set)."}
            </p>
          )}

          <button
            onClick={generate}
            disabled={busy}
            data-testid="generate-pulse-btn"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink py-2.5 text-sm font-medium text-background hover:bg-ink/90 disabled:opacity-40 transition-colors"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
            {items === null ? "Generate pulse" : "Regenerate"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
