import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Brain, CheckCircle2, ExternalLink, Link2, Loader2, Plus, Quote, ShieldCheck, ShieldQuestion, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  bulkConfirmHypotheses,
  bulkRejectHypotheses,
  confirmHypothesis,
  createEpisode,
  createHypothesis,
  getHypothesis,
  linkEvidence,
  listHypotheses,
  rejectHypothesis,
} from "@/services/memoryApi";

// Open+verified first (best triage candidates), then open+contested, then
// plain open, then settled (confirmed/rejected) — newest first within each
// group. Purely a display order; never changes anything about the data.
function triagePriority(hypothesis) {
  if (hypothesis.status !== "open") return 3;
  if (hypothesis.verdict?.verified) return 0;
  if (hypothesis.verdict?.contested) return 1;
  return 2;
}

function sortForTriage(hypotheses) {
  return [...hypotheses].sort((a, b) => {
    const priorityDiff = triagePriority(a) - triagePriority(b);
    if (priorityDiff !== 0) return priorityDiff;
    return (b.created_at || "").localeCompare(a.created_at || "");
  });
}

function sourceTypeForObject(object) {
  if (!object) return "explicit-input";
  if (object.type === "activity" || object.sourceProvider === "uia") return "system-observation";
  if (["chatgpt", "claude", "gemini"].includes(object.sourceProvider) || object.type === "chat") return "chat-import";
  if (object.type === "document" || object.sourceProvider === "wordpress") return "document";
  return "explicit-input";
}

function formatTime(value) {
  if (!value) return "time unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "time unknown" : date.toLocaleString();
}

export function MemoryDialog({ open, onOpenChange, selectedObject, allObjects = [], onOpenObject }) {
  const [hypotheses, setHypotheses] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [newHypothesis, setNewHypothesis] = useState("");
  const [fragment, setFragment] = useState("");
  const [contextWindow, setContextWindow] = useState("");
  const [bronReferentie, setBronReferentie] = useState(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [richting, setRichting] = useState("supporting");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [bulkSelected, setBulkSelected] = useState(() => new Set());

  const loadHypotheses = useCallback(async (preferId) => {
    setLoading(true);
    setError("");
    try {
      const rows = await listHypotheses();
      setHypotheses(rows);
      setSelectedId((current) => {
        const wanted = preferId || current;
        if (wanted && rows.some((row) => row.id === wanted)) return wanted;
        return rows[0]?.id || null;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id) => {
    if (!id) {
      setDetail(null);
      return;
    }
    try {
      setDetail(await getHypothesis(id));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (open) loadHypotheses();
  }, [open, loadHypotheses]);

  useEffect(() => {
    if (open) loadDetail(selectedId);
  }, [open, selectedId, loadDetail]);

  useEffect(() => {
    setFragment("");
    setContextWindow("");
    setBronReferentie(null);
    setSelection({ start: 0, end: 0 });
  }, [selectedObject?.id]);

  const handleCreateHypothesis = async () => {
    const text = newHypothesis.trim();
    if (!text) return;
    setBusy(true);
    try {
      const created = await createHypothesis(text);
      setNewHypothesis("");
      await loadHypotheses(created.id);
      toast.success("Hypothesis created");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const useSelectedFragment = () => {
    const content = selectedObject?.content || "";
    const start = Math.min(selection.start, selection.end);
    const end = Math.max(selection.start, selection.end);
    if (end <= start) {
      toast("Select text in the source box first");
      return;
    }
    setFragment(content.slice(start, end));
    setContextWindow(content.slice(Math.max(0, start - 240), Math.min(content.length, end + 240)));
    setBronReferentie(`chars:${start}-${end}`);
  };

  const handleLink = async () => {
    if (!selectedId || !selectedObject || !fragment.trim()) return;
    setBusy(true);
    setError("");
    try {
      const episode = await createEpisode({
        bronObjectId: selectedObject.id,
        bronsoort: selectedObject.type || "untyped",
        fragment,
        observedAt: selectedObject.occurredAt || null,
        bronReferentie,
        conversationIdentity: selectedObject.providerConversationId || null,
        sourceType: sourceTypeForObject(selectedObject),
        extractionConfidence: 100,
        contextWindow: contextWindow || null,
      });
      await linkEvidence(selectedId, episode.id, richting);
      await loadDetail(selectedId);
      toast.success(episode.reused ? "Existing episode reused and linked" : "Episode captured and linked");
    } catch (err) {
      if (err.status === 409) {
        await loadDetail(selectedId);
        toast("This episode is already linked to the hypothesis");
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await confirmHypothesis(selectedId);
      await loadHypotheses(selectedId);
      await loadDetail(selectedId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    const reden = window.prompt("Why is this hypothesis rejected?");
    if (!reden?.trim()) return;
    setBusy(true);
    try {
      await rejectHypothesis(selectedId, reden.trim());
      await loadHypotheses(selectedId);
      await loadDetail(selectedId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const sortedHypotheses = useMemo(() => sortForTriage(hypotheses), [hypotheses]);
  const openHypotheses = useMemo(() => sortedHypotheses.filter((h) => h.status === "open"), [sortedHypotheses]);

  const toggleBulkSelect = (id) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVerified = () => {
    setBulkSelected(new Set(openHypotheses.filter((h) => h.verdict?.verified).map((h) => h.id)));
  };

  const clearBulkSelection = () => setBulkSelected(new Set());

  const handleBulkConfirm = async () => {
    if (!bulkSelected.size) return;
    setBusy(true);
    try {
      const { results } = await bulkConfirmHypotheses([...bulkSelected]);
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.length - succeeded;
      toast[failed ? "warning" : "success"](
        failed ? `Confirmed ${succeeded}, ${failed} failed (see console)` : `Confirmed ${succeeded} hypothes${succeeded === 1 ? "is" : "es"}`
      );
      if (failed) console.error("Bulk confirm failures:", results.filter((r) => !r.success));
      clearBulkSelection();
      await loadHypotheses(selectedId);
      await loadDetail(selectedId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleBulkReject = async () => {
    if (!bulkSelected.size) return;
    const reden = window.prompt(`Why are these ${bulkSelected.size} hypotheses rejected?`);
    if (!reden?.trim()) return;
    setBusy(true);
    try {
      const { results } = await bulkRejectHypotheses([...bulkSelected], reden.trim());
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.length - succeeded;
      toast[failed ? "warning" : "success"](
        failed ? `Rejected ${succeeded}, ${failed} failed (see console)` : `Rejected ${succeeded} hypothes${succeeded === 1 ? "is" : "es"}`
      );
      if (failed) console.error("Bulk reject failures:", results.filter((r) => !r.success));
      clearBulkSelection();
      await loadHypotheses(selectedId);
      await loadDetail(selectedId);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openSourceObject = (bronObjectId) => {
    if (!allObjects.some((object) => object.id === bronObjectId)) return;
    onOpenChange(false);
    onOpenObject?.(bronObjectId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[86vh] flex flex-col overflow-hidden" data-testid="memory-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl">
            <Brain className="h-5 w-5 text-primary" /> Evidence memory
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="min-h-0 flex-1 grid grid-cols-[280px_1fr] gap-4">
          <aside className="min-h-0 flex flex-col rounded-xl border border-border bg-card/30 p-3">
            <div className="flex gap-2">
              <input
                value={newHypothesis}
                onChange={(event) => setNewHypothesis(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") handleCreateHypothesis(); }}
                placeholder="New hypothesis…"
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                data-testid="memory-new-hypothesis"
              />
              <button
                onClick={handleCreateHypothesis}
                disabled={busy || !newHypothesis.trim()}
                className="rounded-lg bg-primary p-2 text-primary-foreground disabled:opacity-40"
                aria-label="Create hypothesis"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            {openHypotheses.some((h) => h.verdict?.verified) && (
              <div className="mt-3 flex items-center gap-1.5">
                <button
                  onClick={selectAllVerified}
                  disabled={busy}
                  className="rounded-lg border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
                  data-testid="memory-select-all-verified"
                >
                  Select all verified
                </button>
              </div>
            )}

            {bulkSelected.size > 0 && (
              <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-accent/40 p-1.5">
                <span className="px-1 text-[11px] text-muted-foreground">{bulkSelected.size} selected</span>
                <button
                  onClick={handleBulkConfirm}
                  disabled={busy}
                  className="ml-auto rounded-lg bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
                  data-testid="memory-bulk-confirm"
                >
                  Confirm
                </button>
                <button
                  onClick={handleBulkReject}
                  disabled={busy}
                  className="rounded-lg border border-destructive/40 px-2 py-1 text-[11px] text-destructive disabled:opacity-40"
                  data-testid="memory-bulk-reject"
                >
                  Reject
                </button>
                <button onClick={clearBulkSelection} disabled={busy} className="rounded-lg px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent">
                  Clear
                </button>
              </div>
            )}

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto space-y-1">
              {loading ? (
                <Loader2 className="mx-auto mt-6 h-5 w-5 animate-spin text-muted-foreground" />
              ) : sortedHypotheses.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">Create the first hypothesis.</p>
              ) : sortedHypotheses.map((hypothesis) => (
                <div
                  key={hypothesis.id}
                  className={`flex items-start gap-2 rounded-lg px-2 py-2 ${selectedId === hypothesis.id ? "bg-accent" : "hover:bg-accent/50"}`}
                >
                  {hypothesis.status === "open" && (
                    <input
                      type="checkbox"
                      checked={bulkSelected.has(hypothesis.id)}
                      onChange={() => toggleBulkSelect(hypothesis.id)}
                      onClick={(event) => event.stopPropagation()}
                      className="mt-1.5 shrink-0"
                      data-testid={`memory-bulk-select-${hypothesis.id}`}
                    />
                  )}
                  <button onClick={() => setSelectedId(hypothesis.id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-1.5">
                      {hypothesis.verdict?.verified && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" title="Verified: enough independent supporting sources" />}
                      {hypothesis.verdict?.contested && <ShieldQuestion className="h-3.5 w-3.5 shrink-0 text-amber-600" title="Contested: has contradicting evidence" />}
                      <p className="line-clamp-2 text-sm text-ink">{hypothesis.hypothese}</p>
                    </div>
                    <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{hypothesis.status}</p>
                  </button>
                </div>
              ))}
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto pr-1">
            {!detail ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Select or create a hypothesis.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-border p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <p className="font-serif text-lg text-ink">{detail.hypothese}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {detail.verdict?.independentSupportingCount || 0} independent supporting · {detail.verdict?.independentContradictingCount || 0} contradicting
                      </p>
                    </div>
                    <span className="rounded-full border border-border px-2.5 py-1 text-[11px] uppercase text-muted-foreground">
                      {detail.status}
                    </span>
                    {detail.status === "open" && (
                      <>
                        <button onClick={handleConfirm} disabled={busy} className="rounded-lg p-2 text-primary hover:bg-primary/10" title="Confirm">
                          <CheckCircle2 className="h-5 w-5" />
                        </button>
                        <button onClick={handleReject} disabled={busy} className="rounded-lg p-2 text-destructive hover:bg-destructive/10" title="Reject">
                          <XCircle className="h-5 w-5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-border p-4 space-y-3">
                  <div>
                    <p className="text-sm font-medium text-ink">Capture from selected object</p>
                    <p className="text-xs text-muted-foreground">
                      {selectedObject ? (selectedObject.title || "Untitled object") : "Select an archive object before opening Memory."}
                    </p>
                  </div>
                  {selectedObject && (
                    <>
                      <textarea
                        readOnly
                        value={selectedObject.content || ""}
                        onSelect={(event) => setSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
                        className="h-32 w-full resize-none rounded-lg border border-border bg-muted/20 p-3 text-xs leading-relaxed text-ink"
                        data-testid="memory-source-text"
                      />
                      <div className="flex items-center gap-2">
                        <button onClick={useSelectedFragment} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-accent">
                          Use selected text
                        </button>
                        <select value={richting} onChange={(event) => setRichting(event.target.value)} className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs">
                          <option value="supporting">Supporting</option>
                          <option value="contradicting">Contradicting</option>
                          <option value="contextualizing">Contextualizing</option>
                        </select>
                        <span className="text-[11px] text-muted-foreground">{fragment.length} selected characters</span>
                      </div>
                      <textarea
                        value={fragment}
                        readOnly
                        placeholder="The exact frozen observation appears here…"
                        className="h-24 w-full resize-none rounded-lg border border-border bg-muted/20 p-3 text-sm"
                        data-testid="memory-fragment"
                      />
                      <button
                        onClick={handleLink}
                        disabled={busy || !fragment.trim()}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
                        data-testid="memory-link-evidence"
                      >
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                        Freeze episode and link
                      </button>
                    </>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Evidence</p>
                  {(detail.evidence || []).length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">No evidence linked yet.</p>
                  ) : detail.evidence.map((item) => (
                    <article key={item.id} className="rounded-xl border border-border p-4">
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="rounded-full bg-accent px-2 py-0.5 uppercase">{item.richting}</span>
                        <span>{item.episode?.bronsoort}</span>
                        <span>·</span>
                        <span>{formatTime(item.episode?.observed_at)}</span>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Quote className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{item.episode?.fragment}</p>
                      </div>
                      {item.episode?.context_window && (
                        <details className="mt-3 rounded-lg bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                          <summary className="cursor-pointer">Context window</summary>
                          <p className="mt-2 whitespace-pre-wrap">{item.episode.context_window}</p>
                        </details>
                      )}
                      <p className="mt-3 text-[10px] text-muted-foreground/70">
                        {item.episode?.bron_object_id} · captured {formatTime(item.episode?.captured_at)}
                      </p>
                      {allObjects.some((object) => object.id === item.episode?.bron_object_id) ? (
                        <button
                          onClick={() => openSourceObject(item.episode.bron_object_id)}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-ink hover:bg-accent"
                          data-testid={`memory-open-source-${item.id}`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" /> Open source object
                        </button>
                      ) : (
                        <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700">
                          <AlertTriangle className="h-3.5 w-3.5" /> Source object no longer exists
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
