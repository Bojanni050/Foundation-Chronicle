import { useEffect, useState } from "react";
import {
  Cpu,
  Database,
  ArrowRight,
  Sparkles,
  GitBranch,
  Shield,
  Eye,
  CheckCircle,
  HelpCircle,
  Clock,
  Settings,
  Flame,
  Coins,
  Trash2,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AIService } from "@/services/AIService";

function InfoCard({ icon: Icon, title, description, badge, onClick, active }) {
  return (
    <div
      onClick={onClick}
      className={`group relative flex flex-col justify-between rounded-xl border p-4 transition-all duration-300 ${
        onClick ? "cursor-pointer" : ""
      } ${
        active
          ? "border-primary bg-primary/5 shadow-md shadow-primary/5 ring-1 ring-primary/30"
          : "border-border bg-card hover:border-primary/40 hover:bg-accent/20"
      }`}
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className={`rounded-lg p-2 ${active ? "bg-primary/20 text-primary" : "bg-accent text-muted-foreground group-hover:text-primary transition-colors"}`}>
            <Icon className="w-5 h-5" strokeWidth={1.75} />
          </div>
          {badge && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              {badge}
            </span>
          )}
        </div>
        <h4 className="font-serif text-sm font-semibold text-ink">{title}</h4>
        <p className="text-[11px] leading-relaxed text-muted-foreground/90">{description}</p>
      </div>
    </div>
  );
}

export function EngineDialog({ open, onOpenChange }) {
  const [tab, setTab] = useState("architecture"); // architecture | memory | telemetry | philosophy
  const [selectedNode, setSelectedNode] = useState(null);
  const [stats, setStats] = useState({ totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0, calls: [] });

  useEffect(() => {
    if (open) {
      setStats(AIService.getTokenStats());
    }
  }, [open]);

  const handleClearStats = () => {
    if (window.confirm("Are you sure you want to reset all token stats?")) {
      AIService.clearTokenStats();
      setStats({ totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0, calls: [] });
    }
  };

  const nodes = {
    ingest: {
      title: "1. Data Ingestion Pipeline",
      desc: "Captures raw thoughts, browser chats, or files via the Chrome extension (port 4577) or manual paste.",
      detail: "All imports flow into a JSON-based local inbox file first. This acts as a temporary buffer to ensure no data is lost even if the database is busy or sleeping.",
    },
    embedding: {
      title: "2. Local ONNX Embeddings",
      desc: "Computes 1024-dimensional vectors locally in Node.js using Transformers.js CPU ONNX models.",
      detail: "No text ever leaves your machine to compute vectors. If an embedding job fails due to CPU limit or restart, the Auto-Healer job runs on startup to find null embeddings and calculate them in the background.",
    },
    database: {
      title: "3. PostgreSQL & pgvector",
      desc: "Stores structured notes, relations, and vectors using Drizzle ORM and a pgvector index.",
      detail: "Utilizes cosine similarity indexes in PostgreSQL to run blazing-fast searches. Auto-healed and indexed locally for offline-first resilience.",
    },
    dedup: {
      title: "4. Duplicate Auto-Detector",
      desc: "Compares text similarity on import. If cosine similarity > 0.82, it reinforces existing tags rather than creating clutter.",
      detail: "Prevents duplicate processing. Keeps the knowledge base clean by merging repeated captures of the same links or chats and boosting their tags.",
    },
    consolidator: {
      title: "5. Semantic Consolidator",
      desc: "Background job that finds high-similarity memory traits (> 0.75 similarity) and merges them.",
      detail: "If the AI proposes 'interested in coding' and 'interested in software engineering', the Consolidator automatically merges their sources, carrying over the highest confirmation status and confidence.",
    },
    hindsight: {
      title: "6. Temporal Reflection Layer",
      desc: "Chronological analysis that tracks how your habits, preferences, and interests evolve over time.",
      detail: "Instead of treating traits as permanent facts, the Reflection engine records their lifecycles. If you switch from 'prefers Node.js' to 'prefers Go', it deprecates the old trait (validTo) and creates a replaces-link (vervangenDoor).",
    },
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 gap-0 overflow-hidden" data-testid="engine-dialog">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-background/50 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Cpu className="w-5 h-5 animate-pulse" strokeWidth={2} />
            </div>
            <div>
              <DialogTitle className="font-serif text-lg text-ink">Chronicle Engine</DialogTitle>
              <p className="text-[11px] text-muted-foreground">The architecture, algorithms, and philosophy of your personal knowledge engine.</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 rounded-lg bg-accent/40 p-1">
            <button
              onClick={() => { setTab("architecture"); setSelectedNode(null); }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                tab === "architecture" ? "bg-background text-ink shadow-sm" : "text-muted-foreground hover:text-ink"
              }`}
            >
              System Flow
            </button>
            <button
              onClick={() => { setTab("memory"); setSelectedNode(null); }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                tab === "memory" ? "bg-background text-ink shadow-sm" : "text-muted-foreground hover:text-ink"
              }`}
            >
              Memory evolution
            </button>
            <button
              onClick={() => { setTab("telemetry"); setSelectedNode(null); }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                tab === "telemetry" ? "bg-background text-ink shadow-sm" : "text-muted-foreground hover:text-ink"
              }`}
            >
              Telemetry
            </button>
            <button
              onClick={() => { setTab("philosophy"); setSelectedNode(null); }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                tab === "philosophy" ? "bg-background text-ink shadow-sm" : "text-muted-foreground hover:text-ink"
              }`}
            >
              Philosophy
            </button>
          </div>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto p-6 bg-background/30 animate-in fade-in duration-300">
          {tab === "architecture" && (
            <div className="space-y-6">
              {/* Architecture Map Header */}
              <div className="rounded-xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5 border border-primary/20">
                <div className="flex items-start gap-4">
                  <div className="rounded-xl bg-primary/20 p-2.5 text-primary">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="font-serif text-base font-semibold text-ink">Interactive Ingestion & Vector pipeline</h3>
                    <p className="text-xs text-muted-foreground/90 max-w-2xl leading-relaxed">
                      How Chronicle processes raw captures, generates embeddings locally, and checks for duplication in real-time. Click any node to explore technical details.
                    </p>
                  </div>
                </div>
              </div>

              {/* Interactive pipeline */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center relative">
                {/* Node 1 */}
                <InfoCard
                  icon={GitBranch}
                  title="Ingestion"
                  description="Extension scrapers, manual markdown pastes, and JSON chat files load directly into a local inbox."
                  badge="Buffer"
                  onClick={() => setSelectedNode("ingest")}
                  active={selectedNode === "ingest"}
                />

                <div className="hidden md:flex justify-center text-muted-foreground/40">
                  <ArrowRight className="w-5 h-5 animate-pulse" />
                </div>

                {/* Node 2 */}
                <InfoCard
                  icon={Cpu}
                  title="Local ONNX Embeddings"
                  description="Qwen3 / BGE-M3 models run locally on CPU via Transformers.js to generate 1024D vectors."
                  badge="Local AI"
                  onClick={() => setSelectedNode("embedding")}
                  active={selectedNode === "embedding"}
                />

                <div className="hidden md:flex justify-center text-muted-foreground/40">
                  <ArrowRight className="w-5 h-5" />
                </div>

                {/* Node 3 */}
                <InfoCard
                  icon={Database}
                  title="Postgres & pgvector"
                  description="Drizzle schema and pgvector index stores notes, references, and vector embeddings on port 5434."
                  badge="Local DB"
                  onClick={() => setSelectedNode("database")}
                  active={selectedNode === "database"}
                />

                <div className="hidden md:flex justify-center text-muted-foreground/40">
                  <ArrowRight className="w-5 h-5" />
                </div>

                {/* Node 4 */}
                <InfoCard
                  icon={Flame}
                  title="Duplicate Detector"
                  description="Auto-deduplicates raw text inputs if similarity > 0.82 to protect from noise."
                  badge="Auto-Heal"
                  onClick={() => setSelectedNode("dedup")}
                  active={selectedNode === "dedup"}
                />
              </div>

              {/* Connector lines & Detail Box */}
              {selectedNode && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <h4 className="text-sm font-semibold font-serif text-primary flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    {nodes[selectedNode].title}
                  </h4>
                  <p className="mt-1 text-xs text-ink font-sans font-medium">{nodes[selectedNode].desc}</p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground/90 bg-background/50 p-2.5 rounded-lg border border-border/40 font-mono">
                    {nodes[selectedNode].detail}
                  </p>
                </div>
              )}
            </div>
          )}

          {tab === "memory" && (
            <div className="space-y-6">
              {/* Memory Pipeline Flow */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Column 1: Detection */}
                <div className="space-y-4 rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-lg bg-orange-500/10 p-2 text-orange-500">
                      <Eye className="w-5 h-5" />
                    </div>
                    <h3 className="font-serif text-sm font-semibold text-ink">1. Detection & Feedback</h3>
                  </div>
                  <p className="text-xs text-muted-foreground/95 leading-relaxed">
                    AI models analyze your notes and suggest background traits (e.g. "prefers Go over Node.js"). 
                  </p>
                  <div className="space-y-2 border-t border-border/60 pt-3">
                    <div className="rounded bg-accent/30 p-2 text-[10px] text-muted-foreground font-mono">
                      <strong>Negative Feedback Loop:</strong> Rejected memory traits are kept in a tombstone list. When generating new traits, the LLM receives these rejected traits, preventing it from suggesting them again.
                    </div>
                  </div>
                </div>

                {/* Column 2: Consolidator */}
                <div className="space-y-4 rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-lg bg-blue-500/10 p-2 text-blue-500">
                      <Cpu className="w-5 h-5" />
                    </div>
                    <h3 className="font-serif text-sm font-semibold text-ink">2. Semantic Consolidation</h3>
                  </div>
                  <p className="text-xs text-muted-foreground/95 leading-relaxed">
                    Preventing semantic clutter by merging active and proposed memory traits.
                  </p>
                  <div className="space-y-2 border-t border-border/60 pt-3">
                    <div className="rounded bg-accent/30 p-2 text-[10px] text-muted-foreground font-mono">
                      <strong>Similarity Merging:</strong> A background consolidator queries pgvector for traits with similarity &gt; 0.75. Redundant nodes are merged, aggregating their sources (bron_object_ids) and keeping the highest status.
                    </div>
                  </div>
                </div>

                {/* Column 3: Hindsight */}
                <div className="space-y-4 rounded-xl border border-border bg-card p-5">
                  <div className="flex items-center gap-2.5">
                    <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-500">
                      <Clock className="w-5 h-5" />
                    </div>
                    <h3 className="font-serif text-sm font-semibold text-ink">3. Temporal Evolution</h3>
                  </div>
                  <p className="text-xs text-muted-foreground/95 leading-relaxed">
                    Beliefs and habits aren't static. Hindsight tracks how traits change chronologically.
                  </p>
                  <div className="space-y-2 border-t border-border/60 pt-3">
                    <div className="rounded bg-accent/30 p-2 text-[10px] text-muted-foreground font-mono">
                      <strong>Reflective Transition:</strong> Scans notes with occurredAt. When a habit changes, Hindsight deprecates the old trait (setting validTo) and creates a successor link (vervangenDoor), maintaining an audit log of your growth.
                    </div>
                  </div>
                </div>
              </div>

              {/* Disposition parameters */}
              <div className="rounded-xl border border-border bg-card/60 p-5">
                <div className="flex items-start gap-4">
                  <div className="rounded-xl bg-primary/20 p-2.5 text-primary">
                    <Settings className="w-5 h-5" />
                  </div>
                  <div className="space-y-1.5 flex-1">
                    <h4 className="font-serif text-sm font-semibold text-ink flex items-center gap-2">
                      Cognitive Disposition Parameters
                    </h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      You can customize how Chronicle interprets facts and generates insights. These values guide the prompt context for AI Pulse and AI Weave:
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                      <div className="rounded-lg border border-border/55 p-3 bg-background/40">
                        <div className="text-xs font-semibold text-ink">Skepticism (1-5)</div>
                        <div className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                          Controls assertiveness. High values force the AI to hedge claims and highlight gaps. Low values state facts confidently.
                        </div>
                      </div>
                      <div className="rounded-lg border border-border/55 p-3 bg-background/40">
                        <div className="text-xs font-semibold text-ink">Literalism (1-5)</div>
                        <div className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                          Controls interpretation. High values restrict output strictly to explicit facts. Low values encourage reading between the lines.
                        </div>
                      </div>
                      <div className="rounded-lg border border-border/55 p-3 bg-background/40">
                        <div className="text-xs font-semibold text-ink">Empathy (1-5)</div>
                        <div className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                          Controls tone. High values prioritize personal and emotional context, while low values provide detached, fact-focused digests.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "telemetry" && (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-xl border border-border bg-card p-4 space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Prompt Tokens</div>
                  <div className="text-2xl font-serif font-bold text-ink">{stats.totalPromptTokens?.toLocaleString() || 0}</div>
                  <p className="text-[10px] text-muted-foreground/75 leading-relaxed">Inputs loaded into the context window.</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 space-y-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Completion Tokens</div>
                  <div className="text-2xl font-serif font-bold text-ink">{stats.totalCompletionTokens?.toLocaleString() || 0}</div>
                  <p className="text-[10px] text-muted-foreground/75 leading-relaxed">Outputs generated by OpenRouter models.</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4 space-y-1 relative overflow-hidden">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Total Estimated Cost</div>
                  <div className="text-2xl font-serif font-bold text-primary">${stats.totalCost?.toFixed(6) || "0.000000"}</div>
                  <p className="text-[10px] text-muted-foreground/75 leading-relaxed">Calculated using live OpenRouter pricing rates.</p>
                  <div className="absolute right-3 top-3 text-primary/10">
                    <Coins className="w-12 h-12" />
                  </div>
                </div>
              </div>

              {/* Reset stats & Local info */}
              <div className="flex items-center justify-between gap-4 border-b border-border/50 pb-4">
                <div className="text-xs text-muted-foreground">
                  Metrics recorded during active OpenRouter operations since last clear.
                </div>
                <button
                  onClick={handleClearStats}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-destructive hover:bg-destructive/5 transition-colors font-medium"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear Telemetry
                </button>
              </div>

              {/* Table of calls */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-3 border-b border-border bg-accent/10">
                  <h4 className="font-serif text-sm font-semibold text-ink">Recent API Pipeline Call Log</h4>
                </div>
                <div className="overflow-x-auto max-h-[30vh] no-scrollbar">
                  {stats.calls?.length > 0 ? (
                    <table className="w-full text-left text-xs border-collapse font-sans">
                      <thead>
                        <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-accent/5">
                          <th className="px-4 py-2.5">Time</th>
                          <th className="px-4 py-2.5">Feature</th>
                          <th className="px-4 py-2.5">Model</th>
                          <th className="px-4 py-2.5 text-right">Prompt</th>
                          <th className="px-4 py-2.5 text-right">Completion</th>
                          <th className="px-4 py-2.5 text-right">Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {stats.calls.map((call, idx) => (
                          <tr key={idx} className="hover:bg-accent/10">
                            <td className="px-4 py-2 text-muted-foreground/80 font-mono">
                              {new Date(call.timestamp).toLocaleTimeString()}
                            </td>
                            <td className="px-4 py-2 font-medium text-ink">
                              {call.context === "tagging"
                                ? "Auto-tagging"
                                : call.context === "weave"
                                  ? "AI Weave"
                                  : call.context === "pulse"
                                    ? "AI Pulse"
                                    : call.context === "persona"
                                      ? "Persona Detection"
                                      : call.context === "reflection"
                                        ? "Temporal Reflection"
                                        : call.context === "test"
                                          ? "Connection Test"
                                          : call.context}
                            </td>
                            <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground/90 max-w-[150px] truncate" title={call.model}>
                              {call.model?.replace("deepseek/", "") || "unknown"}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                              {call.promptTokens?.toLocaleString()}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                              {call.completionTokens?.toLocaleString()}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-primary font-medium">
                              ${call.cost?.toFixed(6)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-8 text-center text-xs text-muted-foreground">
                      No API calls logged yet. Generate an AI Weave, AI Pulse, or detect Persona traits to see metrics!
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === "philosophy" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Column 1 */}
                <div className="space-y-3 rounded-xl border border-border bg-card p-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Shield className="w-5 h-5" />
                  </div>
                  <h4 className="font-serif text-sm font-semibold text-ink">Local-First and Private</h4>
                  <p className="text-xs text-muted-foreground/90 leading-relaxed font-sans">
                    Chronicle is built on the principle that your memory belongs to you. No logins, no telemetry, and no cloud-hosted vector engines. Your notes and embeddings remain strictly within your local PostgreSQL database on your machine.
                  </p>
                </div>

                {/* Column 2 */}
                <div className="space-y-3 rounded-xl border border-border bg-card p-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500">
                    <Clock className="w-5 h-5" />
                  </div>
                  <h4 className="font-serif text-sm font-semibold text-ink">Calm Technology</h4>
                  <p className="text-xs text-muted-foreground/90 leading-relaxed font-sans">
                    No gamification, no notifications, and no addictive loops. Chronicle is a quiet, local workspace. The AI works only when prompted, acting as a supportive synthesizer of your thoughts rather than a distraction.
                  </p>
                </div>

                {/* Column 3 */}
                <div className="space-y-3 rounded-xl border border-border bg-card p-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-500">
                    <HelpCircle className="w-5 h-5" />
                  </div>
                  <h4 className="font-serif text-sm font-semibold text-ink">Avoid Prompt Bloat</h4>
                  <p className="text-xs text-muted-foreground/90 leading-relaxed font-sans">
                    Instead of flooding LLMs with thousands of raw historical notes (which causes high token costs and dilution), Chronicle extracts stable Persona traits. These traits are injected as a compressed, context-rich lens for highly targeted AI advice.
                  </p>
                </div>
              </div>

              {/* Bottom quote */}
              <div className="rounded-xl border border-border bg-accent/20 p-5 text-center max-w-2xl mx-auto space-y-2 mt-4">
                <p className="font-serif text-sm italic text-ink">
                  "A calm, private memory mirror designed to help you organize thoughts, notice patterns, and reflect on your growth over time."
                </p>
                <p className="text-[10px] text-muted-foreground/70 uppercase tracking-widest font-semibold font-sans">Chronicle Architecture Philosophy</p>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
