import { useEffect, useState } from "react";
import { Loader2, Check, X, Copy, Eye, EyeOff, RefreshCw, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getSettings, saveSettings, AI_FUNCTIONS } from "@/lib/settings";
import { AIService } from "@/services/AIService";
import { fetchOpenRouterModels, getCachedOpenRouterModels, formatPrice } from "@/services/openrouterModels";
import { toast } from "sonner";
import { objectRepository } from "@/repositories";
import { getDB, OBJECT_STORE } from "@/lib/db";
import { invokeTauri } from "@/lib/tauri";
import { startUiaCaptureListener, stopUiaCaptureListener } from "@/services/uiaCapture";
import { relTime } from "@/lib/format";

function Field({ label, children, hint }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

export function SettingsDialog({ open, onOpenChange }) {
  const [s, setS] = useState(getSettings());
  const [showKey, setShowKey] = useState(false);
  const [testState, setTestState] = useState(null); // null | testing | ok | fail
  const [testMsg, setTestMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [models, setModels] = useState([]);
  const [modelsFetchedAt, setModelsFetchedAt] = useState(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [embeddingModel, setEmbeddingModelState] = useState(null); // { model, options } | null
  const [embeddingBusy, setEmbeddingBusy] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);
  const [ggufPath, setGgufPath] = useState("");
  const [ggufSaveState, setGgufSaveState] = useState(null); // null | saving | saved
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityObjects, setActivityObjects] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityDeletingId, setActivityDeletingId] = useState("");

  const handleSeed = async () => {
    setSeedBusy(true);
    try {
      // 1. Seed PostgreSQL server-side traits
      const res = await fetch(`${s.apiUrl}/api/settings/seed`, { method: "POST" });
      if (!res.ok) throw new Error("Server seed failed");
      
      // 2. Clear & Seed IndexedDB objects
      const idb = await getDB();
      await idb.clear(OBJECT_STORE);

      const demoObjects = [
        {
          id: "obj_demo_1",
          type: "note",
          title: "React & Node Setup",
          content: "Decided to build our new company project with React and Node.js. Node is so easy for local web servers, and the package ecosystem is unmatched.",
          tags: ["development", "node", "javascript"],
          occurredAt: "2026-01-10T12:00:00Z",
          temporalText: "in January 2026"
        },
        {
          id: "obj_demo_2",
          type: "note",
          title: "Discovering Go",
          content: "I've started exploring Go. The compiled binaries, clean static typing, and built-in concurrency features (channels/goroutines) are extremely clean compared to JS. I want to build backends in Go.",
          tags: ["development", "go", "learning"],
          occurredAt: "2026-02-15T12:00:00Z",
          temporalText: "in mid-February 2026"
        },
        {
          id: "obj_demo_3",
          type: "note",
          title: "Chronicle Backend Rewrite",
          content: "Migrated all local backend services to Go. Moving away from Node.js entirely for production servers. It's so much faster, uses 10% of the RAM, and single binaries are a joy to run.",
          tags: ["development", "go", "migration"],
          occurredAt: "2026-03-10T12:00:00Z",
          temporalText: "in March 2026"
        },
        {
          id: "obj_demo_4",
          type: "note",
          title: "Local-First Architecture Research",
          content: "Reading Capacities and ink-and-switch articles. Local-first apps are the future. Data ownership, instant offline load times, and vector search on localhost is a superpower.",
          tags: ["philosophy", "local-first", "design"],
          occurredAt: "2026-03-15T12:00:00Z",
          temporalText: "in mid-March 2026"
        },
        {
          id: "obj_demo_5",
          type: "chat",
          title: "AI Chat about Go performance",
          content: "H: Why rewrite in Go?\n\nA: Go compiled binaries are smaller, start faster, and use less memory than Node.js.",
          tags: ["go", "performance"],
          occurredAt: "2026-04-01T12:00:00Z",
          temporalText: "in early April 2026",
          sourceProvider: "claude"
        }
      ];

      for (const obj of demoObjects) {
        await objectRepository.create(obj);
      }

      toast.success("Seeded database with rich developer demo timeline!");
      onOpenChange(false);
      window.location.reload();
    } catch (err) {
      toast.error(`Seeding failed: ${err.message}`);
    }
    setSeedBusy(false);
  };

  useEffect(() => {
    if (open) {
      setS(getSettings());
      setTestState(null);
      setTestMsg("");
      const cached = getCachedOpenRouterModels();
      setModels(cached.models);
      setModelsFetchedAt(cached.fetchedAt);
      loadEmbeddingModel();
      invokeTauri("get_local_model_path").then((p) => setGgufPath(p || ""));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Native activity capture, embedded directly in the Tauri app — see
  // src-tauri/src/uia_capture.rs. No server-side toggle/route: unlike the
  // old PureMemory collector-agent, this never needs the Node server to
  // spawn or manage anything, so the on/off state lives purely in these
  // frontend settings and the Tauri commands below.
  const toggleUiaCapture = async (enabled) => {
    update({ uiaCaptureEnabled: enabled });
    if (enabled) {
      await invokeTauri("start_uia_capture", { includeText: !!s.uiaCaptureText, ocrFallback: !!s.uiaCaptureOcrFallback });
      await startUiaCaptureListener();
    } else {
      await invokeTauri("stop_uia_capture");
      stopUiaCaptureListener();
    }
  };

  const toggleUiaCaptureText = (enabled) => {
    update({ uiaCaptureText: enabled });
    if (s.uiaCaptureEnabled) {
      invokeTauri("start_uia_capture", { includeText: enabled, ocrFallback: !!s.uiaCaptureOcrFallback });
    }
  };

  const toggleUiaCaptureOcrFallback = (enabled) => {
    update({ uiaCaptureOcrFallback: enabled });
    if (s.uiaCaptureEnabled) {
      invokeTauri("start_uia_capture", { includeText: !!s.uiaCaptureText, ocrFallback: enabled });
    }
  };

  // Activity objects don't get their own browsable nav item (see Sidebar.jsx) —
  // they're passive AI-collected context, not content the user authored — but
  // given this is a privacy-sensitive capture (window text, redacted passwords
  // aside), the user still needs somewhere to review and delete what's been
  // captured. This is that somewhere.
  const toggleActivityViewer = async () => {
    const next = !activityOpen;
    setActivityOpen(next);
    if (next && activityObjects.length === 0) {
      setActivityLoading(true);
      try {
        const list = await objectRepository.list({ type: "activity" });
        setActivityObjects(list);
      } finally {
        setActivityLoading(false);
      }
    }
  };

  const deleteActivityObject = async (id) => {
    setActivityDeletingId(id);
    try {
      await objectRepository.delete(id);
      setActivityObjects((prev) => prev.filter((o) => o.id !== id));
    } catch (err) {
      toast.error(`Couldn't delete: ${err.message}`);
    }
    setActivityDeletingId("");
  };

  const saveGgufPath = async () => {
    setGgufSaveState("saving");
    await invokeTauri("set_local_model_path", { path: ggufPath });
    setGgufSaveState("saved");
    setTimeout(() => setGgufSaveState(null), 1500);
  };

  const loadEmbeddingModel = async () => {
    try {
      const res = await fetch(`${getSettings().apiUrl}/api/settings/embedding-model`);
      setEmbeddingModelState(res.ok ? await res.json() : null);
    } catch {
      setEmbeddingModelState(null);
    }
  };

  const update = (patch) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(patch);
  };

  const updateFunctionModel = (fnKey, modelId) => {
    update({ models: { ...s.models, [fnKey]: modelId } });
  };

  const refreshModels = async () => {
    setModelsLoading(true);
    setModelsError("");
    try {
      const list = await fetchOpenRouterModels();
      setModels(list);
      setModelsFetchedAt(Date.now());
    } catch {
      setModelsError("Couldn't reach OpenRouter's model catalog.");
    }
    setModelsLoading(false);
  };

  const test = async () => {
    setTestState("testing");
    setTestMsg("");
    try {
      const r = await AIService.test(s.models.tagging);
      setTestState("ok");
      setTestMsg(`Connected · replied "${r.sample}"`);
    } catch (e) {
      setTestState("fail");
      setTestMsg("Connection failed — check key & model.");
    }
  };

  const fetchToken = async () => {
    try {
      const res = await fetch(`${s.apiUrl}/api/settings/token`);
      if (res.ok) {
        const data = await res.json();
        if (data.token) update({ apiToken: data.token });
      }
    } catch {
      /* server not running */
    }
  };

  const setEmbedding = async (modelKey) => {
    setEmbeddingBusy(true);
    try {
      const res = await fetch(`${s.apiUrl}/api/settings/embedding-model`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelKey }),
      });
      if (res.ok) setEmbeddingModelState(await res.json());
    } catch {
      /* server not running */
    }
    setEmbeddingBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[75vw] max-h-[85vh] overflow-y-auto no-scrollbar" data-testid="settings-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-1">
          {/* AI - OpenRouter */}
          <section className="space-y-4">
            <h3 className="font-serif text-base text-ink">AI · OpenRouter</h3>
            <Field label="OpenRouter API Key" hint="Stored locally in your browser. Sent only to OpenRouter.">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card/50 px-3">
                <input
                  data-testid="settings-openrouter-key"
                  type={showKey ? "text" : "password"}
                  value={s.openrouterKey}
                  onChange={(e) => update({ openrouterKey: e.target.value })}
                  placeholder="sk-or-…"
                  className="flex-1 bg-transparent py-2 text-sm text-ink placeholder:text-muted-foreground/50 focus:outline-none"
                />
                <button onClick={() => setShowKey((v) => !v)} className="text-muted-foreground hover:text-ink" data-testid="toggle-key-visibility">
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>

            <div className="flex items-center justify-between gap-3">
              <button
                onClick={refreshModels}
                disabled={modelsLoading}
                data-testid="fetch-models-btn"
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:bg-primary/20 disabled:opacity-40 transition-colors"
              >
                {modelsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Fetch models from OpenRouter
              </button>
              {modelsFetchedAt && !modelsLoading && (
                <span className="text-[11px] text-muted-foreground/70" data-testid="models-fetched-info">
                  {models.length} models · {new Date(modelsFetchedAt).toLocaleTimeString()}
                </span>
              )}
            </div>
            {modelsError && (
              <p className="text-xs text-destructive" data-testid="models-error">
                {modelsError}
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={test}
                disabled={testState === "testing" || !s.openrouterKey}
                data-testid="test-connection-btn"
                className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-background hover:bg-ink/90 disabled:opacity-40 transition-colors"
              >
                {testState === "testing" && <Loader2 className="w-4 h-4 animate-spin" />}
                {testState === "ok" && <Check className="w-4 h-4" />}
                {testState === "fail" && <X className="w-4 h-4" />}
                Test OpenRouter Connection
              </button>
              {testMsg && (
                <span className={`text-xs ${testState === "ok" ? "text-primary" : "text-destructive"}`} data-testid="test-msg">
                  {testMsg}
                </span>
              )}
            </div>
          </section>

          <div className="border-t border-border" />

          {/* Native UI Automation activity capture (desktop app only) */}
          <section className="space-y-4">
            <h3 className="font-serif text-base text-ink">Activity capture (Windows UI Automation)</h3>
            <p className="text-xs text-muted-foreground">
              Reads the active app/window and, optionally, visible text of UI elements directly via Windows' own
              accessibility tree — no external process, no clipboard access. Runs inside Chronicle's desktop app;
              has no effect in a browser preview.
            </p>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                data-testid="uia-capture-toggle"
                checked={!!s.uiaCaptureEnabled}
                onChange={(e) => toggleUiaCapture(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Track active app/window
            </label>

            <div className="pt-1 space-y-1.5">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  data-testid="uia-capture-text-toggle"
                  checked={!!s.uiaCaptureText}
                  onChange={(e) => toggleUiaCaptureText(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                Also capture visible text of UI elements
              </label>
              <p className="text-[11px] text-muted-foreground/70">
                Off by default: reads text from the on-screen text/edit/document elements of the focused window
                (e.g. an address bar, a text editor's content). Anything shaped like a password (a token with
                mixed case, digits, and symbols) is redacted before it ever leaves the capture module.
              </p>
            </div>

            <div className="pt-1 space-y-1.5 pl-6">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  data-testid="uia-capture-ocr-toggle"
                  checked={!!s.uiaCaptureOcrFallback}
                  onChange={(e) => toggleUiaCaptureOcrFallback(e.target.checked)}
                  disabled={!s.uiaCaptureText}
                  className="h-4 w-4 rounded border-border"
                />
                Use Native OCR fallback for non-text apps
              </label>
              <p className="text-[11px] text-muted-foreground/70">
                If the active app yields no text via UIA (like videos or games), Chronicle will briefly take a
                memory-only screenshot and use Windows' built-in OCR to extract the text. Fast and 100% local.
              </p>
            </div>

            <div className="pt-1">
              <button
                onClick={toggleActivityViewer}
                data-testid="activity-viewer-toggle"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-ink transition-colors"
              >
                {activityOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {activityOpen ? "Hide" : "Review"} captured activity
              </button>

              {activityOpen && (
                <div className="mt-2 max-h-60 overflow-y-auto rounded-lg border border-border no-scrollbar" data-testid="activity-viewer-list">
                  {activityLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : activityObjects.length === 0 ? (
                    <p className="px-3 py-4 text-xs text-muted-foreground">Nothing captured yet.</p>
                  ) : (
                    <div className="divide-y divide-border">
                      {activityObjects.map((o) => (
                        <div key={o.id} className="flex items-start justify-between gap-2 px-3 py-2" data-testid={`activity-item-${o.id}`}>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm text-ink">{o.title || (o.tags || [])[0] || "Untitled"}</p>
                              <span className="shrink-0 text-[11px] text-muted-foreground/70">{relTime(o.updatedAt)}</span>
                            </div>
                            {o.content && (
                              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                {o.content.replace(/\s+/g, " ").trim()}
                              </p>
                            )}
                          </div>
                          <button
                            onClick={() => deleteActivityObject(o.id)}
                            disabled={activityDeletingId === o.id}
                            data-testid={`activity-delete-${o.id}`}
                            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 transition-colors"
                            aria-label="Delete captured entry"
                          >
                            {activityDeletingId === o.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <div className="border-t border-border" />

          {/* Optional local model */}
          <section className="space-y-4">
            <h3 className="font-serif text-base text-ink">Local model (optional)</h3>
            <p className="text-xs text-muted-foreground">
              Route every AI function through a local, GPU-accelerated model server (e.g. llama-server) instead of
              OpenRouter. Off by default — no key needed when enabled, nothing changes for anyone who leaves this off.
            </p>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                data-testid="use-local-model-toggle"
                checked={!!s.useLocalModel}
                onChange={(e) => update({ useLocalModel: e.target.checked })}
                className="h-4 w-4 rounded border-border"
              />
              Use local model instead of OpenRouter
            </label>
            <Field label="Local model URL" hint="OpenAI-compatible endpoint, e.g. your llama-server sidecar.">
              <input
                type="text"
                value={s.localModelUrl || ""}
                onChange={(e) => update({ localModelUrl: e.target.value })}
                placeholder="http://127.0.0.1:8080/v1"
                className="w-full rounded-lg border border-border bg-card/50 px-3 py-2 text-xs text-ink focus:outline-none"
              />
            </Field>
            <Field label="GGUF model path" hint="Passed to the llama-server sidecar on next app start. Desktop app only.">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={ggufPath}
                  onChange={(e) => setGgufPath(e.target.value)}
                  placeholder="C:\models\your-model.gguf"
                  className="flex-1 rounded-lg border border-border bg-card/50 px-3 py-2 text-xs text-ink focus:outline-none"
                />
                <button
                  onClick={saveGgufPath}
                  disabled={ggufSaveState === "saving"}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-xs font-medium text-background hover:bg-ink/90 disabled:opacity-40 transition-colors"
                >
                  {ggufSaveState === "saving" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {ggufSaveState === "saved" && <Check className="w-3.5 h-3.5" />}
                  Save
                </button>
              </div>
            </Field>
          </section>

          <div className="border-t border-border" />

          {/* Per-function models */}
          <section className="space-y-4">
            <h3 className="font-serif text-base text-ink">Models per function</h3>
            <p className="text-xs text-muted-foreground">
              Each AI feature can use its own model. Fetch OpenRouter's catalog above to see live pricing and capabilities here.
            </p>
            {AI_FUNCTIONS.map((fn) => {
              const current = s.models[fn.key];
              const inList = models.some((m) => m.id === current);
              return (
                <Field key={fn.key} label={fn.label} hint={fn.hint}>
                  <select
                    data-testid={`model-select-${fn.key}`}
                    value={current}
                    onChange={(e) => updateFunctionModel(fn.key, e.target.value)}
                    className="w-full rounded-lg border border-border bg-card/50 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-primary/40"
                  >
                    {!inList && <option value={current}>{current} (not in fetched list)</option>}
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} — {formatPrice(m.promptPer1M)} / {formatPrice(m.completionPer1M)} ·{" "}
                        {Math.round(m.contextLength / 1000)}k ctx
                        {m.capabilities.length ? ` · ${m.capabilities.join(", ")}` : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              );
            })}
          </section>

          <div className="border-t border-border" />

          {/* Local embeddings */}
          <section className="space-y-4">
            <h3 className="font-serif text-base text-ink">Embeddings (local)</h3>
            <p className="text-xs text-muted-foreground">
              Runs on the local server, not OpenRouter — no key, no cost, no network dependency.
            </p>
            {embeddingModel ? (
              <Field label="Model">
                <select
                  data-testid="embedding-model-select"
                  value={embeddingModel.model}
                  disabled={embeddingBusy}
                  onChange={(e) => setEmbedding(e.target.value)}
                  className="w-full rounded-lg border border-border bg-card/50 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-40"
                >
                  {embeddingModel.options.map((key) => (
                    <option key={key} value={key}>
                      {key === "qwen3-embedding-0.6b"
                        ? "Qwen3-Embedding-0.6B (recommended — calibrated short-phrase behavior)"
                        : key === "bge-m3"
                          ? "BGE-M3 (better for long documents, not short kenmerken)"
                          : key}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <p className="text-sm text-muted-foreground">Can't reach the local server — run `npm run server`.</p>
            )}
          </section>

          <div className="border-t border-border" />

          {/* Extension / local server */}
          <section className="space-y-4">
            <h3 className="font-serif text-base text-ink">Browser extension</h3>
            <Field label="Local API URL" hint="Where the Chronicle local server runs.">
              <input
                data-testid="settings-api-url"
                value={s.apiUrl}
                onChange={(e) => update({ apiUrl: e.target.value })}
                className="w-full rounded-lg border border-border bg-card/50 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </Field>
            <Field label="API Token" hint="Paste this into the extension popup to authorize sends.">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card/50 px-3">
                <input
                  data-testid="settings-api-token"
                  value={s.apiToken}
                  onChange={(e) => update({ apiToken: e.target.value })}
                  placeholder="run the local server to generate…"
                  className="flex-1 bg-transparent py-2 font-mono text-xs text-ink placeholder:text-muted-foreground/50 focus:outline-none"
                />
                <button
                  onClick={() => {
                    navigator.clipboard?.writeText(s.apiToken || "");
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="text-muted-foreground hover:text-ink"
                  data-testid="copy-token-btn"
                >
                  {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <button onClick={fetchToken} data-testid="fetch-token-btn" className="text-[11px] text-primary hover:underline">
                Fetch token from local server
              </button>
            </Field>
          </section>

          <div className="border-t border-border" />

          <section className="space-y-4">
            <h3 className="font-serif text-base text-ink">Workspace</h3>
            <Field label="Workspace name">
              <input
                data-testid="settings-workspace-name"
                value={s.workspaceName}
                onChange={(e) => update({ workspaceName: e.target.value })}
                className="w-full rounded-lg border border-border bg-card/50 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
            </Field>
          </section>

          <div className="border-t border-border" />

          <section className="space-y-4">
            <h3 className="font-serif text-base text-ink">Demo data</h3>
            <p className="text-xs text-muted-foreground">
              Seed the workspace and PostgreSQL database with a pre-made timeline of developer notes and memory traits. This will reset your current objects.
            </p>
            <button
              onClick={handleSeed}
              disabled={seedBusy}
              data-testid="seed-demo-btn"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/95 disabled:opacity-40 transition-colors"
            >
              {seedBusy && <Loader2 className="w-4 h-4 animate-spin" />}
              Seed Developer Timeline
            </button>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
