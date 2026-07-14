import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@/App.css";
import { Toaster, toast } from "sonner";
import { PanelRightOpen } from "lucide-react";
import { LoginScreen } from "@/components/LoginScreen";
import { objectRepository } from "@/repositories";
import { getSettings } from "@/lib/settings";
import { pollInbox } from "@/services/inboxSync";
import { runAutomaticPersonaMaintenance } from "@/services/personaSync";
import { findRelatedLocal } from "@/services/weave";
import { startUiaCaptureListener } from "@/services/uiaCapture";
import { fetchSystemStatus } from "@/services/statusService";
import { invokeTauri } from "@/lib/tauri";
import { Sidebar } from "@/components/Sidebar";
import { ObjectList } from "@/components/ObjectList";
import { ObjectDetail } from "@/components/ObjectDetail";
import { AIWeave } from "@/components/AIWeave";
import { WelcomeEmpty } from "@/components/EmptyState";
import { SearchDialog } from "@/components/dialogs/SearchDialog";
import { ImportChatDialog } from "@/components/dialogs/ImportChatDialog";
import { SettingsDialog } from "@/components/dialogs/SettingsDialog";
import { PulseDialog } from "@/components/dialogs/PulseDialog";
import { PersonaDialog } from "@/components/dialogs/PersonaDialog";
import { GraphDialog } from "@/components/dialogs/GraphDialog";
import { AddTypeDialog } from "@/components/dialogs/AddTypeDialog";
import { EngineDialog } from "@/components/dialogs/EngineDialog";
import { DedupDialog } from "@/components/dialogs/DedupDialog";
import { CaptureLogDialog } from "@/components/dialogs/CaptureLogDialog";

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [view, setView] = useState("all");
  const [objects, setObjects] = useState([]);
  const [allObjects, setAllObjects] = useState([]);
  const [counts, setCounts] = useState({ all: 0 });
  const [selectedId, setSelectedId] = useState(null);
  const [workspaceName, setWorkspaceName] = useState(getSettings().workspaceName);
  const [syncing, setSyncing] = useState(false);
  const [weaveOpen, setWeaveOpen] = useState(false);
  const [pulseBusy, setPulseBusy] = useState(false);

  const [dlg, setDlg] = useState({ search: false, import: false, settings: false, pulse: false, persona: false, graph: false, addType: false, engine: false, dedup: false, captureLog: false });
  const [globalStatus, setGlobalStatus] = useState(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const refresh = useCallback(async () => {
    const [list, all, c] = await Promise.all([
      objectRepository.list({ type: viewRef.current }),
      objectRepository.list(),
      objectRepository.counts(),
    ]);
    setObjects(list);
    setAllObjects(all);
    setCounts(c);
  }, []);

  useEffect(() => {
    refresh();
  }, [view, refresh]);

  useEffect(() => {
    const onChange = () => setWorkspaceName(getSettings().workspaceName);
    window.addEventListener("chronicle-settings-changed", onChange);
    return () => window.removeEventListener("chronicle-settings-changed", onChange);
  }, []);

  // inbox polling from local extension pipeline
  const failCount = useRef(0);
  const sync = useCallback(async (manual) => {
    if (manual) setSyncing(true);
    const n = await pollInbox();
    if (manual) setSyncing(false);
    if (n > 0) {
      failCount.current = 0;
      await refresh();
      toast.success(`${n} chat${n === 1 ? "" : "s"} pulled from extension`);
    } else if (n === 0) {
      failCount.current = 0;
      if (manual) toast("Inbox empty — start the local server & extension to queue chats.");
    } else {
      failCount.current += 1;
      if (manual) toast("Local server not reachable — run `npm run server` on your machine.");
    }
    return n;
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => { sync(false); }, 5000);
    sync(false);
    return () => clearInterval(id);
  }, [sync]);

  // Automatic persona pattern detection + temporal reflection — the
  // background counterpart to PersonaDialog's manual buttons. Both
  // underlying calls are self-gating (detection skips objects it's already
  // scanned, reflection skips objects unchanged since the last automatic
  // pass), so an LLM call only actually happens when there's real new
  // material — no separate "N new objects" burst counter needed on top.
  // 30 min keeps a bulk import from sitting unprocessed for too long
  // without re-running often enough to matter when nothing's changed.
  useEffect(() => {
    const run = async () => {
      const { detected, reflected } = await runAutomaticPersonaMaintenance();
      if (detected > 0 || reflected > 0) {
        const parts = [];
        if (detected > 0) parts.push(`${detected} new pattern${detected === 1 ? "" : "s"}`);
        if (reflected > 0) parts.push(`${reflected} temporal change${reflected === 1 ? "" : "s"}`);
        toast.success(`Persona updated: ${parts.join(", ")}`);
      }
    };
    const id = setInterval(run, 30 * 60 * 1000);
    run();
    return () => clearInterval(id);
  }, []);

  // System status monitoring (every 30s)
  useEffect(() => {
    const checkStatus = async () => {
      const status = await fetchSystemStatus();
      setGlobalStatus(status);
    };
    const id = setInterval(checkStatus, 30000);
    checkStatus();
    return () => clearInterval(id);
  }, []);

  // Native Windows UI Automation activity capture (desktop app only — a
  // no-op in a plain browser preview, same fail-silent pattern as every
  // other Tauri-dependent feature). Off by default; only starts if the user
  // has actually opted in via Settings.
  useEffect(() => {
    const { uiaCaptureEnabled, uiaCaptureText, uiaCaptureOcrFallback } = getSettings();
    if (!uiaCaptureEnabled) return;
    invokeTauri("start_uia_capture", { includeText: !!uiaCaptureText, ocrFallback: !!uiaCaptureOcrFallback });
    startUiaCaptureListener();
  }, []);

  const selectedObject = allObjects.find((o) => o.id === selectedId) || null;

  // The AI weave panel is hidden by default and opens automatically only when
  // the open entry actually has related entries to show. Manual toggle always
  // wins until the selection (or its related set) changes.
  const related = useMemo(
    () => (selectedObject ? findRelatedLocal(selectedObject, allObjects) : []),
    [selectedObject, allObjects]
  );
  const autoKey = `${selectedId || ""}:${related.length}`;
  const lastAutoKey = useRef(null);
  useEffect(() => {
    if (autoKey !== lastAutoKey.current) {
      lastAutoKey.current = autoKey;
      setWeaveOpen(related.length > 0);
    }
  }, [autoKey, related.length]);

  const createNew = useCallback(async (type) => {
    const obj = await objectRepository.create({ type: type || null, title: "", content: "" });
    await refresh();
    setSelectedId(obj.id);
  }, [refresh]);

  // 'all' and 'untyped' views create an untyped item — type is an optional
  // classification you can add later, never required at creation.
  const listNew = () =>
    createNew(view === "all" || view === "untyped" ? null : view);

  const onSaved = useCallback((updated) => {
    setObjects((prev) => {
      const has = prev.some((o) => o.id === updated.id);
      const v = viewRef.current;
      const inView = v === "all" || updated.type === v || (v === "untyped" && !updated.type);
      let next = prev.map((o) => (o.id === updated.id ? updated : o));
      if (!has && inView) next = [updated, ...prev];
      if (has && !inView) next = prev.filter((o) => o.id !== updated.id);
      return next.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    });
    setAllObjects((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    objectRepository.counts().then(setCounts);
  }, []);

  const onDelete = useCallback(async (id) => {
    try {
      await objectRepository.delete(id);
    } catch (err) {
      toast.error(err.message || "Could not delete object");
      return;
    }
    if (selectedId === id) setSelectedId(null);
    await refresh();
    toast("Object deleted");
  }, [selectedId, refresh]);

  const openObject = useCallback((id) => {
    setSelectedId(id);
    setDlg((d) => ({ ...d, search: false }));
  }, []);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setDlg((d) => ({ ...d, search: true }));
      } else if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        createNew(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createNew]);

  if (!authenticated) {
    return <LoginScreen onSuccess={() => setAuthenticated(true)} />;
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        counts={counts}
        view={view}
        onSelectView={(v) => { setView(v); setSelectedId(null); }}
        onNew={createNew}
        onImport={() => setDlg((d) => ({ ...d, import: true }))}
        onAddType={() => setDlg((d) => ({ ...d, addType: true }))}
        onSearch={() => setDlg((d) => ({ ...d, search: true }))}
        onPulse={() => setDlg((d) => ({ ...d, pulse: true }))}
        pulseBusy={pulseBusy}
        onPersona={() => setDlg((d) => ({ ...d, persona: true }))}
        onGraph={() => setDlg((d) => ({ ...d, graph: true }))}
        onEngine={() => setDlg((d) => ({ ...d, engine: true }))}
        onDedup={() => setDlg((d) => ({ ...d, dedup: true }))}
        onCaptureLog={() => setDlg((d) => ({ ...d, captureLog: true }))}
        onLock={() => setAuthenticated(false)}
        onSettings={() => setDlg((d) => ({ ...d, settings: true }))}
        workspaceName={workspaceName}
      />

      <ObjectList
        view={view}
        objects={objects}
        selectedId={selectedId}
        onSelect={openObject}
        onNew={listNew}
      />

      <main className="flex-1 overflow-hidden">
        {selectedObject ? (
          <ObjectDetail
            key={selectedObject.id}
            object={selectedObject}
            onSaved={onSaved}
            onDelete={onDelete}
          />
        ) : (
          <WelcomeEmpty />
        )}
      </main>

      {weaveOpen ? (
        <AIWeave
          selectedObject={selectedObject}
          allObjects={allObjects}
          onOpen={openObject}
          onRefreshInbox={() => sync(true)}
          syncing={syncing}
          onCollapse={() => setWeaveOpen(false)}
        />
      ) : (
        <button
          data-testid="weave-open-rail"
          onClick={() => setWeaveOpen(true)}
          title="Show AI weave"
          className="group flex h-full w-11 shrink-0 flex-col items-center gap-3 border-l border-border bg-background/40 pt-5 text-muted-foreground hover:text-primary transition-colors"
        >
          <PanelRightOpen className="w-4 h-4" strokeWidth={1.75} />
          {related.length > 0 && (
            <span
              data-testid="weave-hint-dot"
              className="h-1.5 w-1.5 rounded-full bg-primary"
              title={`${related.length} related`}
            />
          )}
        </button>
      )}

      <SearchDialog
        open={dlg.search}
        onOpenChange={(v) => setDlg((d) => ({ ...d, search: v }))}
        onOpenObject={openObject}
      />
      <ImportChatDialog
        open={dlg.import}
        onOpenChange={(v) => setDlg((d) => ({ ...d, import: v }))}
        onImported={async (n) => { await refresh(); toast.success(`Imported ${n} chat${n === 1 ? "" : "s"}`); }}
      />
      <SettingsDialog open={dlg.settings} onOpenChange={(v) => setDlg((d) => ({ ...d, settings: v }))} />
      <PulseDialog open={dlg.pulse} onOpenChange={(v) => setDlg((d) => ({ ...d, pulse: v }))} onBusyChange={setPulseBusy} />
      <PersonaDialog open={dlg.persona} onOpenChange={(v) => setDlg((d) => ({ ...d, persona: v }))} />
      <GraphDialog
        open={dlg.graph}
        onOpenChange={(v) => setDlg((d) => ({ ...d, graph: v }))}
        onOpenObject={openObject}
      />
      <AddTypeDialog
        open={dlg.addType}
        onOpenChange={(v) => setDlg((d) => ({ ...d, addType: v }))}
        onCreated={(type) => { setView(type.key); createNew(type.key); }}
      />
      <EngineDialog
        open={dlg.engine}
        onOpenChange={(v) => setDlg((d) => ({ ...d, engine: v }))}
      />
      <DedupDialog
        open={dlg.dedup}
        onOpenChange={(v) => {
          setDlg((d) => ({ ...d, dedup: v }));
          // Deletions happen directly against the repository inside the
          // dialog — refresh App's own object state once it closes so the
          // list/counts reflect whatever was actually removed.
          if (!v) refresh();
        }}
      />
      <CaptureLogDialog
        open={dlg.captureLog}
        onOpenChange={(v) => setDlg((d) => ({ ...d, captureLog: v }))}
      />

      {globalStatus && (globalStatus.backend !== 'ok' || globalStatus.db !== 'ok') && (
        <div className="fixed bottom-4 left-4 z-50 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive backdrop-blur shadow-lg flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive"></span>
          </span>
          <div>
            <strong>System Offline:</strong> {globalStatus.backend !== 'ok' ? 'Node.js server unreachable.' : 'PostgreSQL Database unreachable.'}
          </div>
          <button onClick={() => setDlg(d => ({ ...d, engine: true }))} className="ml-2 text-xs underline">
            Details
          </button>
        </div>
      )}

      <Toaster position="bottom-center" theme="light" toastOptions={{ style: { background: "hsl(30 12% 22%)", color: "hsl(36 33% 97%)", border: "none" } }} />
    </div>
  );
}
