import { useCallback, useEffect, useRef, useState } from "react";
import "@/App.css";
import { Toaster, toast } from "sonner";
import { objectRepository } from "@/repositories";
import { getSettings } from "@/lib/settings";
import { pollInbox } from "@/services/inboxSync";
import { Sidebar } from "@/components/Sidebar";
import { ObjectList } from "@/components/ObjectList";
import { ObjectDetail } from "@/components/ObjectDetail";
import { AIWeave } from "@/components/AIWeave";
import { WelcomeEmpty } from "@/components/EmptyState";
import { SearchDialog } from "@/components/dialogs/SearchDialog";
import { ImportChatDialog } from "@/components/dialogs/ImportChatDialog";
import { SettingsDialog } from "@/components/dialogs/SettingsDialog";
import { PulseDialog } from "@/components/dialogs/PulseDialog";

export default function App() {
  const [view, setView] = useState("all");
  const [objects, setObjects] = useState([]);
  const [allObjects, setAllObjects] = useState([]);
  const [counts, setCounts] = useState({ all: 0 });
  const [selectedId, setSelectedId] = useState(null);
  const [workspaceName, setWorkspaceName] = useState(getSettings().workspaceName);
  const [syncing, setSyncing] = useState(false);

  const [dlg, setDlg] = useState({ search: false, import: false, settings: false, pulse: false });
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
    let id;
    sync(false);
    id = setInterval(async () => {
      // stop auto-polling after repeated failures (local server absent, e.g. hosted preview)
      if (failCount.current >= 3) {
        clearInterval(id);
        return;
      }
      await sync(false);
    }, 5000);
    return () => clearInterval(id);
  }, [sync]);

  const selectedObject = allObjects.find((o) => o.id === selectedId) || null;

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
    await objectRepository.delete(id);
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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar
        counts={counts}
        view={view}
        onSelectView={(v) => { setView(v); setSelectedId(null); }}
        onNew={createNew}
        onImport={() => setDlg((d) => ({ ...d, import: true }))}
        onSearch={() => setDlg((d) => ({ ...d, search: true }))}
        onPulse={() => setDlg((d) => ({ ...d, pulse: true }))}
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

      <AIWeave
        selectedObject={selectedObject}
        allObjects={allObjects}
        onOpen={openObject}
        onRefreshInbox={() => sync(true)}
        syncing={syncing}
      />

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
      <PulseDialog open={dlg.pulse} onOpenChange={(v) => setDlg((d) => ({ ...d, pulse: v }))} />

      <Toaster position="bottom-center" theme="light" toastOptions={{ style: { background: "hsl(30 12% 22%)", color: "hsl(36 33% 97%)", border: "none" } }} />
    </div>
  );
}
