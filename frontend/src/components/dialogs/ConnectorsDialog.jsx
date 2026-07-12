import { useCallback, useEffect, useState } from "react";
import {
  Cable,
  Check,
  Loader2,
  Plus,
  Plug,
  PlugZap,
  RefreshCw,
  Trash2,
  Globe,
  X,
  Database,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { getSettings } from "@/lib/settings";
import {
  getConnectors,
  getConnectorTypes,
  createConnector,
  deleteConnector,
  testConnector,
  syncConnector,
} from "@/services/connectorSync";

function Field({ label, children, hint }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
    </div>
  );
}

function ConnectorCard({ connector, onTest, onSync, onDelete, busyId }) {
  const busy = busyId === connector.id;
  const isBusyAction = busyId && busyId.startsWith(`${connector.id}-`);

  return (
    <div className="rounded-lg border border-border/60 p-3 space-y-2" data-testid={`connector-${connector.id}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {connector.type === "wordpress" ? (
            <Globe className="w-4 h-4 text-primary" strokeWidth={1.75} />
          ) : (
            <Database className="w-4 h-4 text-primary" strokeWidth={1.75} />
          )}
          <span className="text-sm font-medium text-ink">{connector.label}</span>
          <span className="text-[11px] text-muted-foreground bg-muted/50 rounded px-1.5 py-0.5">
            {connector.type}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {connector.status === "connected" ? (
            <span className="flex items-center gap-1 text-[11px] text-green-700 bg-green-50 rounded-full px-2 py-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
              Connected
            </span>
          ) : connector.status === "error" ? (
            <span className="flex items-center gap-1 text-[11px] text-destructive bg-destructive/10 rounded-full px-2 py-0.5">
              <X className="w-2.5 h-2.5" />
              Error
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground bg-muted/50 rounded-full px-2 py-0.5">
              Not tested
            </span>
          )}
          <button
            onClick={() => onDelete(connector.id)}
            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
            title="Remove connector"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="text-xs text-muted-foreground line-clamp-1">
        {connector.type === "wordpress" ? connector.config?.siteUrl : ""}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onTest(connector.id)}
          disabled={busy}
          data-testid={`test-${connector.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent/80 px-2.5 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent disabled:opacity-40 transition-colors"
        >
          {busyId === `${connector.id}-test` ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Plug className="w-3 h-3" />
          )}
          Test
        </button>
        <button
          onClick={() => onSync(connector.id)}
          disabled={busy}
          data-testid={`sync-${connector.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-background hover:bg-ink/90 disabled:opacity-40 transition-colors"
        >
          {busyId === `${connector.id}-sync` ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          Sync
        </button>
        {connector.lastSyncAt && (
          <span className="text-[10px] text-muted-foreground/70 ml-auto">
            Last sync: {new Date(connector.lastSyncAt).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}

export function ConnectorsDialog({ open, onOpenChange }) {
  const [state, setState] = useState(null); // { connectors, types } | null
  const [busyId, setBusyId] = useState(null);
  const [note, setNote] = useState({ text: "", type: "info" });

  // Add-form state
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState("wordpress");
  const [newLabel, setNewLabel] = useState("");
  const [newSiteUrl, setNewSiteUrl] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newAppPassword, setNewAppPassword] = useState("");

  const load = useCallback(async () => {
    const [connectors, types] = await Promise.all([getConnectors(), getConnectorTypes()]);
    setState({ connectors, types });
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const showNote = (text, type = "info") => {
    setNote({ text, type });
    if (type !== "error") setTimeout(() => setNote({ text: "", type: "info" }), 4000);
  };

  const handleTest = async (id) => {
    setBusyId(`${id}-test`);
    setNote({ text: "", type: "info" });
    try {
      const result = await testConnector(id);
      if (result.ok) {
        showNote("Connection successful!");
      } else {
        showNote(`Connection failed: ${result.error}`, "error");
      }
    } catch (err) {
      showNote(`Test failed: ${err.message}`, "error");
    }
    setBusyId(null);
    await load();
  };

  const handleSync = async (id) => {
    setBusyId(`${id}-sync`);
    setNote({ text: "", type: "info" });
    try {
      const result = await syncConnector(id);
      if (result.ok) {
        showNote(`Synced ${result.posts?.length || 0} posts from WordPress.`);
      } else {
        showNote(`Sync failed: ${result.error}`, "error");
      }
    } catch (err) {
      showNote(`Sync failed: ${err.message}`, "error");
    }
    setBusyId(null);
    await load();
  };

  const handleDelete = async (id) => {
    try {
      await deleteConnector(id);
      showNote("Connector removed.");
      await load();
    } catch (err) {
      showNote(`Couldn't delete: ${err.message}`, "error");
    }
  };

  const handleCreate = async () => {
    if (!newLabel.trim() || !newSiteUrl.trim() || !newUsername.trim() || !newAppPassword.trim()) {
      showNote("Please fill in all fields.", "error");
      return;
    }
    setBusyId("creating");
    setNote({ text: "", type: "info" });
    try {
      await createConnector(newType, newLabel.trim(), {
        siteUrl: newSiteUrl.trim(),
        username: newUsername.trim(),
        appPassword: newAppPassword.trim(),
      });
      showNote("Connector created!");
      setAdding(false);
      setNewLabel("");
      setNewSiteUrl("");
      setNewUsername("");
      setNewAppPassword("");
      await load();
    } catch (err) {
      showNote(`Failed: ${err.message}`, "error");
    }
    setBusyId(null);
  };

  const connectors = state?.connectors || [];
  const types = state?.types || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="connectors-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-xl">
            <Cable className="w-5 h-5 text-primary" /> Connectoren
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            Verbind Chronicle met externe software. Data wordt lokaal opgeslagen als Chronicle-objecten.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1 max-h-[65vh] overflow-y-auto no-scrollbar">
          {/* Add connector form */}
          {adding ? (
            <div className="rounded-lg border border-border/80 bg-muted/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink">New WordPress connector</p>
                <button
                  onClick={() => setAdding(false)}
                  className="rounded p-1 text-muted-foreground hover:text-ink"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <Field label="Label">
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="My WordPress Blog"
                  className="w-full rounded-lg border border-border bg-card/50 px-3 py-2 text-sm text-ink placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </Field>
              <Field label="Site URL">
                <input
                  type="url"
                  value={newSiteUrl}
                  onChange={(e) => setNewSiteUrl(e.target.value)}
                  placeholder="https://example.com"
                  className="w-full rounded-lg border border-border bg-card/50 px-3 py-2 text-sm text-ink placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </Field>
              <Field label="WordPress username" hint="The username you log into WordPress with.">
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full rounded-lg border border-border bg-card/50 px-3 py-2 text-sm text-ink placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </Field>
              <Field label="Application password" hint="Generate one under Users → Application Passwords in your WordPress dashboard.">
                <input
                  type="password"
                  value={newAppPassword}
                  onChange={(e) => setNewAppPassword(e.target.value)}
                  placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                  className="w-full rounded-lg border border-border bg-card/50 px-3 py-2 text-sm text-ink placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </Field>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleCreate}
                  disabled={busyId === "creating"}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-background hover:bg-ink/90 disabled:opacity-40 transition-colors"
                >
                  {busyId === "creating" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  Add connector
                </button>
                <button
                  onClick={() => setAdding(false)}
                  className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-ink transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              data-testid="add-connector-btn"
              className="flex w-full items-center gap-3 rounded-lg border-2 border-dashed border-border/70 px-4 py-3 text-sm text-muted-foreground hover:border-primary/50 hover:text-ink transition-colors"
            >
              <PlugZap className="w-4 h-4 text-primary" strokeWidth={1.75} />
              <span>Add connector...</span>
            </button>
          )}

          {/* Connector list */}
          {connectors.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No connectors yet. Add one above to connect Chronicle with your external tools.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Configured connectors
              </p>
              {connectors.map((c) => (
                <ConnectorCard
                  key={c.id}
                  connector={c}
                  onTest={handleTest}
                  onSync={handleSync}
                  onDelete={handleDelete}
                  busyId={busyId}
                />
              ))}
            </div>
          )}

          {note.text && (
            <p
              className={`text-[11px] ${note.type === "error" ? "text-destructive" : "text-primary/80"}`}
              data-testid="connector-note"
            >
              {note.text}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}