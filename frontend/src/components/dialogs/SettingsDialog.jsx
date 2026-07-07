import { useEffect, useState } from "react";
import { Loader2, Check, X, Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getSettings, saveSettings, AI_FUNCTIONS } from "@/lib/settings";
import { AIService } from "@/services/AIService";
import { fetchOpenRouterModels, getCachedOpenRouterModels, formatPrice } from "@/services/openrouterModels";

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

  useEffect(() => {
    if (open) {
      setS(getSettings());
      setTestState(null);
      setTestMsg("");
      const cached = getCachedOpenRouterModels();
      setModels(cached.models);
      setModelsFetchedAt(cached.fetchedAt);
      loadEmbeddingModel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto no-scrollbar" data-testid="settings-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-1">
          {/* AI */}
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
                Test connection
              </button>
              {testMsg && (
                <span className={`text-xs ${testState === "ok" ? "text-primary" : "text-destructive"}`} data-testid="test-msg">
                  {testMsg}
                </span>
              )}
            </div>
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
