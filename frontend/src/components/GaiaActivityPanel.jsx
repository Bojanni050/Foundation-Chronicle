// Small, collapsible panel showing what Gaia's Hermes backend is actually
// doing (tool calls, tool results, warnings) while she's working on a reply
// — not just her final answer. Polls Chronicle's own proxy (never talks to
// 127.0.0.1:9120 directly — same CORS reasoning as the chat proxy itself).
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Activity, BrainCircuit } from "lucide-react";
import { getSettings } from "@/lib/settings";

function friendlyLine(line) {
  // Trim Hermes' own log-level prefix (e.g. "WARNING agent.tool_executor:")
  // down to something a non-developer can skim. Reasoning lines have no
  // such prefix — they're the model's own text, passed through as-is.
  if (line.stream === "reasoning") return line.text;
  return line.text.replace(/^(WARNING|INFO|ERROR)\s+[\w.]+:\s*/, "");
}

export function GaiaActivityPanel({ active }) {
  const [expanded, setExpanded] = useState(false);
  const [lines, setLines] = useState([]);
  const sinceRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    const { apiUrl, gaiaHermesEnabled } = getSettings();
    if (!gaiaHermesEnabled || !apiUrl) return;

    if (active) {
      if (!sinceRef.current) {
        sinceRef.current = new Date().toISOString();
        setLines([]);
      }
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(
            `${apiUrl}/api/settings/gaia-hermes/activity?since=${encodeURIComponent(sinceRef.current)}`
          );
          if (res.ok) {
            const { lines: newLines } = await res.json();
            if (newLines?.length) setLines((prev) => [...prev, ...newLines]);
          }
        } catch {
          /* best-effort — activity panel is a nice-to-have, never blocks chat */
        }
      }, 1000);
    } else {
      sinceRef.current = null;
    }

    return () => clearInterval(pollRef.current);
  }, [active]);

  if (!lines.length) return null;

  return (
    <div className="mx-4 mb-2 rounded-md border border-border bg-card/40 text-[11px]">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-muted-foreground hover:text-ink"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Activity className="w-3 h-3" />
        Wat Gaia deed ({lines.length})
      </button>
      {expanded && (
        <div className="max-h-48 overflow-y-auto border-t border-border px-2 py-1.5 space-y-1.5">
          {lines.map((l, i) =>
            l.stream === "reasoning" ? (
              <div key={i} className="rounded bg-primary/5 border border-primary/20 p-1.5">
                <div className="flex items-center gap-1 text-primary/80 mb-0.5">
                  <BrainCircuit className="w-3 h-3" />
                  <span className="font-medium">Gaia denkt</span>
                </div>
                <div className="text-ink/80 whitespace-pre-wrap font-sans">{friendlyLine(l)}</div>
              </div>
            ) : (
              <div
                key={i}
                className={`font-mono ${l.stream === "stderr" ? "text-amber-600/80" : "text-muted-foreground"}`}
              >
                {friendlyLine(l)}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
