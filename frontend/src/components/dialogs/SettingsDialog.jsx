import { useEffect, useState } from "react";
import { Loader2, Check, X, Copy, Eye, EyeOff } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getSettings, saveSettings, MODEL_SUGGESTIONS } from "@/lib/settings";
import { AIService } from "@/services/AIService";

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

  useEffect(() => {
    if (open) {
      setS(getSettings());
      setTestState(null);
      setTestMsg("");
    }
  }, [open]);

  const update = (patch) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(patch);
  };

  const test = async () => {
    setTestState("testing");
    setTestMsg("");
    try {
      const r = await AIService.test();
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

            <Field label="Model" hint="Free text — OpenRouter's catalog changes often.">
              <input
                data-testid="settings-model"
                value={s.model}
                onChange={(e) => update({ model: e.target.value })}
                className="w-full rounded-lg border border-border bg-card/50 px-3 py-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-primary/40"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {MODEL_SUGGESTIONS.map((m) => (
                  <button
                    key={m}
                    onClick={() => update({ model: m })}
                    data-testid={`model-suggestion-${m}`}
                    className="rounded-full bg-accent px-2.5 py-1 text-[11px] text-accent-foreground hover:bg-primary/20 transition-colors"
                  >
                    {m}
                  </button>
                ))}
              </div>
            </Field>

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
