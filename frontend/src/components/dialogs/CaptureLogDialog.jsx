import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getSettings } from "@/lib/settings";

// Pure visibility into what pollInbox() has notified the memory-engine
// about — the "event-hook after distribution" plug-in point. No action is
// taken on these entries anywhere; this dialog is the debug window onto
// them, nothing more, by design.
export function CaptureLogDialog({ open, onOpenChange }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setUnreachable(false);
      try {
        const { apiUrl } = getSettings();
        const res = await fetch(`${apiUrl}/api/settings/capture-activity`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setEntries(Array.isArray(data.entries) ? [...data.entries].reverse() : []);
      } catch {
        if (!cancelled) setUnreachable(true);
      }
      if (!cancelled) setLoading(false);
    };
    load();
    const interval = setInterval(load, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[75vh] flex flex-col overflow-hidden" data-testid="capture-log-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl">
            <Radio className="w-5 h-5 text-primary" /> Capture log
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground pb-2">
          Wat er net binnenkwam en verdeeld is naar IndexedDB — puur zichtbaarheid, geen actie hier.
        </p>
        {loading && entries.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : unreachable ? (
          <p className="p-4 text-sm text-muted-foreground">Lokale server niet bereikbaar.</p>
        ) : entries.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Nog niets gezien.</p>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-1">
            {entries.map((e, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm" data-testid={`capture-log-entry-${i}`}>
                <span className="flex-1 truncate text-ink">{e.title}</span>
                {e.sourceProvider && (
                  <span className="text-[11px] text-muted-foreground/70 shrink-0">{e.sourceProvider}</span>
                )}
                <span className="text-[11px] text-muted-foreground/50 shrink-0">
                  {new Date(e.at).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
