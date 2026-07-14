import { useEffect, useRef, useState } from "react";
import { Archive, Upload, Loader2, Check, X, Copy, Eye, EyeOff, RefreshCw, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
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
import {
  buildChronicleBackup,
  checkBackupReadiness,
  downloadChronicleBackup,
  getLastBackupExport,
  mergeChronicleBackup,
  readChronicleBackupFile,
} from "@/services/backupService";
import {
  loadDataInventory,
  purgeDerivedMemory,
  purgeOrphanAttachments,
  inspectInterruptedRestoreSessions,
  reconcileInterruptedRestoreSessions,
} from "@/services/maintenanceApi";
import { rebuildSearchIndex } from "@/services/searchReindex";
import { repairOrphanDerivedIndexes, runIntegrityAudit } from "@/services/integrityAudit";
import { previewSourceRecovery, recoverSourceFromEpisodes } from "@/services/provenanceRecovery";

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

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
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupHealthBusy, setBackupHealthBusy] = useState(false);
  const [backupHealth, setBackupHealth] = useState(null);
  const [lastBackupExport, setLastBackupExport] = useState(getLastBackupExport());
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreCandidate, setRestoreCandidate] = useState(null);
  const [maintenance, setMaintenance] = useState(null);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState(null);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [reindex, setReindex] = useState(null);
  const reindexAbort = useRef(null);
  const [integrityAudit, setIntegrityAudit] = useState(null);
  const [integrityBusy, setIntegrityBusy] = useState(false);
  const [integrityRepairConfirm, setIntegrityRepairConfirm] = useState(false);
  const [integrityRepairBusy, setIntegrityRepairBusy] = useState(false);
  const [recoveryPreview, setRecoveryPreview] = useState(null);
  const [recoveryPreviewBusy, setRecoveryPreviewBusy] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [restoreSessions, setRestoreSessions] = useState(null);
  const [restoreSessionsBusy, setRestoreSessionsBusy] = useState(false);
  const [restoreSessionsConfirm, setRestoreSessionsConfirm] = useState(false);
  const [restoreSessionsRepairBusy, setRestoreSessionsRepairBusy] = useState(false);

  const handleBackup = async () => {
    setBackupBusy(true);
    try {
      const backup = await buildChronicleBackup();
      downloadChronicleBackup(backup);
      const recorded = getLastBackupExport();
      setLastBackupExport(recorded);
      setBackupHealth({ status: "current", lastExport: recorded, missingReferencedCount: 0 });
      const counts = backup.manifest.counts;
      toast.success(
        `Backup created: ${counts.objects} objects, ${counts.attachments} attachments, ${counts.episodes} episodes`,
      );
    } catch (err) {
      toast.error(`Backup failed: ${err.message}`);
    } finally {
      setBackupBusy(false);
    }
  };

  const handleBackupReadiness = async () => {
    setBackupHealthBusy(true);
    try {
      const health = await checkBackupReadiness();
      setBackupHealth(health);
      setLastBackupExport(health.lastExport);
    } catch (err) {
      toast.error(`Backup readiness check failed: ${err.message}`);
    } finally {
      setBackupHealthBusy(false);
    }
  };

  const handleRestoreFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setRestoreBusy(true);
    setRestoreCandidate(null);
    try {
      const { backup, preflight, impact } = await readChronicleBackupFile(file);
      setRestoreCandidate({ backup, preflight, impact, fileName: file.name });
      toast.success("Backup validated against the current database. Review the summary before merging.");
    } catch (err) {
      toast.error(`Backup rejected: ${err.message}`);
    } finally {
      setRestoreBusy(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreCandidate) return;
    setRestoreBusy(true);
    try {
      const result = await mergeChronicleBackup(restoreCandidate.backup);
      toast.success(
        `Backup merged: ${result.objects} objects, ${result.attachments} attachments, ${result.counts.episodes} episodes`,
      );
      if (result.cleanupWarning) toast.warning(result.cleanupWarning);
      onOpenChange(false);
      window.location.reload();
    } catch (err) {
      const rollbackWarning = err.attachmentRollbackError
        ? ` Attachment cleanup also failed: ${err.attachmentRollbackError}`
        : "";
      toast.error(`Restore failed: ${err.message}.${rollbackWarning}`);
      setRestoreBusy(false);
    }
  };

  const refreshMaintenance = async () => {
    setMaintenanceLoading(true);
    try {
      setMaintenance(await loadDataInventory());
    } catch (err) {
      toast.error(`Storage scan failed: ${err.message}`);
    } finally {
      setMaintenanceLoading(false);
    }
  };

  const handlePurge = async () => {
    if (!purgeTarget || reindex?.running) return;
    setPurgeBusy(true);
    try {
      const result = purgeTarget === "attachments"
        ? await purgeOrphanAttachments()
        : await purgeDerivedMemory();
      if (purgeTarget === "attachments") {
        toast.success(`Deleted ${result.deleted} orphan attachment files (${formatBytes(result.bytes)})`);
      } else {
        toast.success(`Deleted ${result.objectChunks} search chunks and ${result.objectEmbeddings} object embeddings`);
      }
      setPurgeTarget(null);
      await refreshMaintenance();
    } catch (err) {
      toast.error(`Purge failed: ${err.message}`);
    } finally {
      setPurgeBusy(false);
    }
  };

  const handleReindex = async (force) => {
    if (purgeBusy) return;
    setPurgeTarget(null);
    const controller = new AbortController();
    reindexAbort.current = controller;
    setReindex({ running: true, total: 0, completed: 0, succeeded: 0, failed: 0, failures: [] });
    try {
      const result = await rebuildSearchIndex({
        force,
        signal: controller.signal,
        onProgress: (progress) => setReindex({ ...progress, running: true }),
      });
      setReindex({ ...result, running: false });
      if (result.cancelled) {
        toast("Search rebuild cancelled. A later repair run will resume remaining objects.");
      } else if (result.failed) {
        toast.error(`Search rebuild completed with ${result.failed} failed object${result.failed === 1 ? "" : "s"}`);
      } else {
        toast.success(`Search index ready: ${result.succeeded} object${result.succeeded === 1 ? "" : "s"} rebuilt`);
      }
      await refreshMaintenance();
    } catch (err) {
      setReindex((current) => ({ ...current, running: false, fatalError: err.message }));
      toast.error(`Search rebuild failed: ${err.message}`);
    } finally {
      reindexAbort.current = null;
    }
  };

  const cancelReindex = () => reindexAbort.current?.abort();

  const handleIntegrityAudit = async () => {
    setIntegrityBusy(true);
    setIntegrityRepairConfirm(false);
    setRecoveryPreview(null);
    try {
      setIntegrityAudit(await runIntegrityAudit());
    } catch (err) {
      toast.error(`Integrity audit failed: ${err.message}`);
    } finally {
      setIntegrityBusy(false);
    }
  };

  const handleIntegrityRepair = async () => {
    setIntegrityRepairBusy(true);
    try {
      const result = await repairOrphanDerivedIndexes();
      toast.success(`Removed ${result.objectChunks} orphan chunks and ${result.objectEmbeddings} orphan embeddings`);
      setIntegrityRepairConfirm(false);
      await handleIntegrityAudit();
    } catch (err) {
      toast.error(`Index repair failed: ${err.message}`);
    } finally {
      setIntegrityRepairBusy(false);
    }
  };

  const handleRecoveryPreview = async (bronObjectId) => {
    setRecoveryPreviewBusy(bronObjectId);
    try {
      setRecoveryPreview(await previewSourceRecovery(bronObjectId));
    } catch (err) {
      toast.error(`Source recovery preview failed: ${err.message}`);
    } finally {
      setRecoveryPreviewBusy("");
    }
  };

  const handleRecoverSource = async () => {
    if (!recoveryPreview) return;
    setRecoveryBusy(true);
    try {
      const result = await recoverSourceFromEpisodes(recoveryPreview.bronObjectId);
      toast.success(`Recovered locked source object from ${result.episodeCount} immutable episode${result.episodeCount === 1 ? "" : "s"}`);
      setRecoveryPreview(null);
      await handleIntegrityAudit();
    } catch (err) {
      toast.error(`Source recovery failed: ${err.message}`);
    } finally {
      setRecoveryBusy(false);
    }
  };

  const handleInspectRestoreSessions = async () => {
    setRestoreSessionsBusy(true);
    setRestoreSessionsConfirm(false);
    try {
      setRestoreSessions(await inspectInterruptedRestoreSessions());
    } catch (err) {
      toast.error(`Restore session inspection failed: ${err.message}`);
    } finally {
      setRestoreSessionsBusy(false);
    }
  };

  const handleReconcileRestoreSessions = async () => {
    setRestoreSessionsRepairBusy(true);
    try {
      const result = await reconcileInterruptedRestoreSessions();
      toast.success(`Restore sessions reconciled: ${result.finalized} finalized, ${result.rolledBack} rolled back`);
      if (result.unresolved) toast.warning(`${result.unresolved} mixed or damaged session${result.unresolved === 1 ? " needs" : "s need"} manual review`);
      setRestoreSessionsConfirm(false);
      await handleInspectRestoreSessions();
    } catch (err) {
      toast.error(`Restore session reconciliation failed: ${err.message}`);
    } finally {
      setRestoreSessionsRepairBusy(false);
    }
  };

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
      setLastBackupExport(getLastBackupExport());
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
            <h3 className="font-serif text-base text-ink">Archive backup</h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Exports IndexedDB objects, custom types, raw attachment files, and PostgreSQL memory into one
              checksummed JSON archive. API keys, PIN data, model paths, embeddings, and search indexes are excluded.
            </p>
            <button
              onClick={handleBackup}
              disabled={backupBusy}
              data-testid="export-backup-btn"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-accent disabled:opacity-40 transition-colors"
            >
              {backupBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4 text-primary" />}
              {backupBusy ? "Building complete backup…" : "Export complete backup"}
            </button>

            <div className="rounded-lg border border-border bg-card/40 p-3 space-y-2" data-testid="backup-readiness">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-ink">Backup readiness</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {lastBackupExport
                      ? `Last archive generated ${new Date(lastBackupExport.createdAt).toLocaleString()}`
                      : "No successfully generated archive recorded in this browser."}
                  </p>
                </div>
                <button
                  onClick={handleBackupReadiness}
                  disabled={backupHealthBusy || backupBusy || restoreBusy}
                  data-testid="check-backup-readiness-btn"
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-ink hover:bg-accent disabled:opacity-40"
                >
                  {backupHealthBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {backupHealthBusy ? "Checking sources…" : "Check freshness"}
                </button>
              </div>
              {backupHealth && (
                <p className={`text-xs ${backupHealth.status === "blocked" || backupHealth.status === "outdated" ? "text-destructive" : "text-muted-foreground"}`}>
                  {backupHealth.status === "current" && "Current — objects and memory match the last generated archive."}
                  {backupHealth.status === "outdated" && "New or changed data exists since the last generated archive."}
                  {backupHealth.status === "blocked" && `Blocked — ${backupHealth.missingReferencedCount} referenced attachment file${backupHealth.missingReferencedCount === 1 ? " is" : "s are"} missing.`}
                  {backupHealth.status === "never" && "No baseline exists yet. Generate a complete backup."}
                  {backupHealth.status === "unknown" && "The previous export predates freshness fingerprints. Generate a new backup baseline."}
                </p>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card/40 p-3 space-y-3">
              <div>
                <p className="text-sm font-medium text-ink">Restore from backup</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  First validates the archive and every attachment checksum. Restore is a non-destructive merge:
                  existing extra records remain, matching IDs use the archived version, and immutable episodes are reused.
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-ink hover:bg-accent transition-colors">
                {restoreBusy && !restoreCandidate
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Upload className="h-4 w-4 text-primary" />}
                {restoreBusy && !restoreCandidate ? "Validating backup…" : "Choose backup file"}
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={handleRestoreFile}
                  disabled={restoreBusy}
                  className="sr-only"
                  data-testid="restore-backup-file"
                />
              </label>

              {restoreCandidate && (
                <div className="rounded-md border border-primary/25 bg-primary/5 p-3 space-y-2" data-testid="restore-backup-preview">
                  <p className="break-all text-xs font-medium text-ink">{restoreCandidate.fileName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Created {new Date(restoreCandidate.backup.manifest.createdAt).toLocaleString()} · {restoreCandidate.backup.manifest.counts.objects} objects · {restoreCandidate.backup.manifest.counts.attachments} attachments · {restoreCandidate.backup.manifest.counts.episodes} episodes
                  </p>
                  <p className="text-[11px] text-primary" data-testid="restore-preflight-compatible">
                    Database preflight passed · rollback verified · {restoreCandidate.preflight.episodeReused} immutable episodes can be reused
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4" data-testid="restore-impact-report">
                    <div className="rounded border border-border bg-background p-2">
                      <p className="text-muted-foreground">Objects</p>
                      <p className="mt-1 text-ink">+{restoreCandidate.impact.objects.added} new · {restoreCandidate.impact.objects.overwritten} overwritten</p>
                    </div>
                    <div className="rounded border border-border bg-background p-2">
                      <p className="text-muted-foreground">Custom types</p>
                      <p className="mt-1 text-ink">+{restoreCandidate.impact.customTypes.added} new · {restoreCandidate.impact.customTypes.overwritten} overwritten</p>
                    </div>
                    <div className="rounded border border-border bg-background p-2">
                      <p className="text-muted-foreground">Attachments</p>
                      <p className="mt-1 text-ink">+{restoreCandidate.impact.attachments.added} upload · {restoreCandidate.impact.attachments.reused} reused</p>
                    </div>
                    <div className="rounded border border-border bg-background p-2">
                      <p className="text-muted-foreground">Episodes</p>
                      <p className="mt-1 text-ink">+{restoreCandidate.impact.memory.episodesAdded} new · {restoreCandidate.impact.memory.episodesReused} reused</p>
                    </div>
                  </div>
                  {restoreCandidate.impact.workspace.changes && (
                    <p className="text-[11px] text-muted-foreground">
                      Workspace name changes from “{restoreCandidate.impact.workspace.currentName}” to “{restoreCandidate.impact.workspace.restoredName}”.
                    </p>
                  )}
                  {restoreCandidate.impact.objects.overwritten > 0 && (
                    <p className="break-all text-[11px] text-destructive">
                      Archived versions overwrite matching object IDs: {restoreCandidate.impact.objects.overwrittenIds.join(", ")}
                      {restoreCandidate.impact.objects.overwritten > restoreCandidate.impact.objects.overwrittenIds.length ? "…" : ""}
                    </p>
                  )}
                  <button
                    onClick={handleRestore}
                    disabled={restoreBusy}
                    data-testid="confirm-restore-backup-btn"
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/95 disabled:opacity-40 transition-colors"
                  >
                    {restoreBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                    {restoreBusy ? "Merging validated backup…" : "Merge validated backup"}
                  </button>
                </div>
              )}
            </div>
          </section>

          <div className="border-t border-border" />

          <section className="space-y-4" data-testid="data-management-section">
            <div>
              <h3 className="font-serif text-base text-ink">Data management</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Inspect local storage and remove only rebuildable search indexes or attachment files that no current object references.
                Source objects, knowledge, hypotheses, evidence, and immutable episodes are never purged here.
              </p>
            </div>
            <button
              onClick={refreshMaintenance}
              disabled={maintenanceLoading || purgeBusy || reindex?.running}
              data-testid="scan-storage-btn"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-accent disabled:opacity-40 transition-colors"
            >
              {maintenanceLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4 text-primary" />}
              {maintenanceLoading ? "Scanning storage…" : maintenance ? "Refresh storage scan" : "Scan local storage"}
            </button>

            <div className="rounded-md border border-border bg-card/40 p-3 space-y-3" data-testid="restore-session-recovery">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-ink">Interrupted restore sessions</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    Persisted session journals survive a server restart. Fully referenced files can be finalized; fully unreferenced files can be rolled back safely.
                  </p>
                </div>
                <button
                  onClick={handleInspectRestoreSessions}
                  disabled={restoreSessionsBusy || restoreSessionsRepairBusy || reindex?.running || purgeBusy}
                  data-testid="inspect-restore-sessions-btn"
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-ink hover:bg-accent disabled:opacity-40"
                >
                  {restoreSessionsBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {restoreSessionsBusy ? "Inspecting journals…" : "Inspect restore journals"}
                </button>
              </div>

              {restoreSessions !== null && (
                <div className="space-y-2" data-testid="restore-session-results">
                  {restoreSessions.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">No interrupted restore sessions found.</p>
                  ) : (
                    <>
                      {restoreSessions.slice(0, 5).map((session) => (
                        <div key={session.id} className={`rounded border p-2 text-[11px] ${session.disposition === "mixed" || session.disposition === "attention" ? "border-destructive/30 bg-destructive/5" : "border-border bg-background"}`}>
                          <p className="font-medium text-ink">Session {session.id}</p>
                          <p className="mt-1 text-muted-foreground">
                            {session.createdAttachmentIds.length} new files · {session.referencedCount} referenced · {session.missingFileCount} missing · {session.disposition}
                          </p>
                        </div>
                      ))}
                      {restoreSessions.some((session) => session.disposition === "mixed" || session.disposition === "attention") && (
                        <p className="text-[11px] text-destructive">
                          Mixed or damaged sessions are report-only; Chronicle will not guess whether their files should be kept or deleted.
                        </p>
                      )}
                      {restoreSessions.some((session) => session.disposition === "finalize" || session.disposition === "rollback") && !restoreSessionsConfirm && (
                        <button
                          onClick={() => setRestoreSessionsConfirm(true)}
                          data-testid="reconcile-restore-sessions-btn"
                          className="rounded-md border border-primary/30 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
                        >
                          Reconcile safe sessions
                        </button>
                      )}
                      {restoreSessionsConfirm && (
                        <div className="rounded border border-primary/30 bg-primary/5 p-2 space-y-2">
                          <p className="text-[11px] text-ink">
                            Finalize fully referenced sessions and delete only newly created files from fully unreferenced sessions?
                          </p>
                          <div className="flex gap-2">
                            <button
                              onClick={handleReconcileRestoreSessions}
                              disabled={restoreSessionsRepairBusy}
                              data-testid="confirm-reconcile-restore-sessions-btn"
                              className="inline-flex items-center gap-2 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
                            >
                              {restoreSessionsRepairBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                              {restoreSessionsRepairBusy ? "Reconciling…" : "Confirm reconciliation"}
                            </button>
                            <button
                              onClick={() => setRestoreSessionsConfirm(false)}
                              disabled={restoreSessionsRepairBusy}
                              className="rounded border border-border px-3 py-1.5 text-xs text-ink disabled:opacity-40"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-md border border-border bg-card/40 p-3 space-y-3" data-testid="integrity-audit-panel">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-ink">Cross-store integrity audit</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    Compares PostgreSQL provenance, knowledge usage, attachments, and derived indexes with the current IndexedDB object IDs.
                  </p>
                </div>
                <button
                  onClick={handleIntegrityAudit}
                  disabled={integrityBusy || integrityRepairBusy || reindex?.running || purgeBusy}
                  data-testid="run-integrity-audit-btn"
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-ink hover:bg-accent disabled:opacity-40"
                >
                  {integrityBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {integrityBusy ? "Auditing references…" : integrityAudit ? "Run audit again" : "Run integrity audit"}
                </button>
              </div>

              {integrityAudit && (
                <div className="space-y-3" data-testid="integrity-audit-results">
                  <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-5">
                    {[
                      ["Episode sources", integrityAudit.missingEpisodeSources.count],
                      ["Knowledge sources", integrityAudit.missingKnowledgeSources.count],
                      ["Usage objects", integrityAudit.missingUsageObjects.count],
                      ["Missing attachments", integrityAudit.missingAttachments.count],
                      ["Orphan indexes", integrityAudit.orphanDerivedIndexes.count],
                    ].map(([label, count]) => (
                      <div key={label} className={`rounded border p-2 ${count ? "border-destructive/30 bg-destructive/5" : "border-border bg-background"}`}>
                        <p className="text-muted-foreground">{label}</p>
                        <p className={`mt-1 font-medium ${count ? "text-destructive" : "text-ink"}`}>{count}</p>
                      </div>
                    ))}
                  </div>

                  {(integrityAudit.missingEpisodeSources.count > 0 || integrityAudit.missingKnowledgeSources.count > 0 || integrityAudit.missingUsageObjects.count > 0 || integrityAudit.missingAttachments.count > 0) && (
                    <div className="space-y-1 text-[11px] text-muted-foreground">
                      <p>Provenance issues are report-only: restore the missing source object or review the affected immutable record manually.</p>
                      {[...new Map(integrityAudit.missingEpisodeSources.items.map((item) => [item.bron_object_id, item])).values()].slice(0, 3).map((item) => (
                        <div key={item.bron_object_id} className="flex flex-wrap items-center justify-between gap-2">
                          <p className="break-all">Episode source missing: {item.bron_object_id}</p>
                          <button
                            onClick={() => handleRecoveryPreview(item.bron_object_id)}
                            disabled={!!recoveryPreviewBusy || recoveryBusy}
                            className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-ink hover:bg-accent disabled:opacity-40"
                            data-testid={`preview-source-recovery-${item.id}`}
                          >
                            {recoveryPreviewBusy === item.bron_object_id && <Loader2 className="h-3 w-3 animate-spin" />}
                            Preview recovery
                          </button>
                        </div>
                      ))}
                      {integrityAudit.missingKnowledgeSources.items.slice(0, 2).map((item) => (
                        <p key={item.id} className="break-all">Knowledge “{item.kenmerk}” → missing {item.missing_object_ids.join(", ")}</p>
                      ))}
                      {integrityAudit.missingAttachments.items.slice(0, 3).map((id) => (
                        <p key={id} className="break-all">Missing attachment {id}</p>
                      ))}
                    </div>
                  )}

                  {recoveryPreview && (
                    <div className="rounded border border-primary/30 bg-primary/5 p-3 space-y-2" data-testid="source-recovery-preview">
                      <div>
                        <p className="text-xs font-medium text-ink">Recover “{recoveryPreview.draft.title}”</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {recoveryPreview.episodeCount} immutable episodes · {recoveryPreview.evidenceCount} evidence links · {recoveryPreview.hypothesisCount} hypotheses
                        </p>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Chronicle will create a locked object with the original object ID. Its content is a partial reconstruction, not the original source.
                      </p>
                      <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-[10px] text-muted-foreground">
                        {recoveryPreview.draft.content.slice(0, 1600)}
                        {recoveryPreview.draft.content.length > 1600 ? "\n…" : ""}
                      </pre>
                      <div className="flex gap-2">
                        <button
                          onClick={handleRecoverSource}
                          disabled={recoveryBusy}
                          data-testid="confirm-source-recovery-btn"
                          className="inline-flex items-center gap-2 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"
                        >
                          {recoveryBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          {recoveryBusy ? "Recovering…" : "Create locked recovery object"}
                        </button>
                        <button
                          onClick={() => setRecoveryPreview(null)}
                          disabled={recoveryBusy}
                          className="rounded border border-border px-3 py-1.5 text-xs text-ink disabled:opacity-40"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {integrityAudit.orphanDerivedIndexes.count > 0 && !integrityRepairConfirm && (
                    <button
                      onClick={() => setIntegrityRepairConfirm(true)}
                      disabled={integrityRepairBusy}
                      data-testid="repair-orphan-indexes-btn"
                      className="inline-flex items-center gap-2 rounded-md border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove orphan derived indexes
                    </button>
                  )}

                  {integrityRepairConfirm && (
                    <div className="rounded border border-destructive/30 bg-destructive/5 p-2 space-y-2">
                      <p className="text-[11px] text-ink">
                        Remove derived index rows for object IDs that no longer exist? Source and immutable memory records remain untouched.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={handleIntegrityRepair}
                          disabled={integrityRepairBusy}
                          data-testid="confirm-repair-orphan-indexes-btn"
                          className="inline-flex items-center gap-2 rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground disabled:opacity-40"
                        >
                          {integrityRepairBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          {integrityRepairBusy ? "Repairing…" : "Confirm repair"}
                        </button>
                        <button
                          onClick={() => setIntegrityRepairConfirm(false)}
                          disabled={integrityRepairBusy}
                          className="rounded border border-border px-3 py-1.5 text-xs text-ink disabled:opacity-40"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {maintenance && (
              <div className="space-y-3" data-testid="storage-inventory">
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div className="rounded-md border border-border bg-card/40 p-2">
                    <p className="text-muted-foreground">Attachments</p>
                    <p className="mt-1 font-medium text-ink">{maintenance.attachments.totalCount} · {formatBytes(maintenance.attachments.totalBytes)}</p>
                  </div>
                  <div className="rounded-md border border-border bg-card/40 p-2">
                    <p className="text-muted-foreground">Orphan files</p>
                    <p className="mt-1 font-medium text-ink">{maintenance.attachments.orphanCount} · {formatBytes(maintenance.attachments.orphanBytes)}</p>
                  </div>
                  <div className="rounded-md border border-border bg-card/40 p-2">
                    <p className="text-muted-foreground">Search chunks</p>
                    <p className="mt-1 font-medium text-ink">{maintenance.memory.object_chunks}</p>
                  </div>
                  <div className="rounded-md border border-border bg-card/40 p-2">
                    <p className="text-muted-foreground">Object embeddings</p>
                    <p className="mt-1 font-medium text-ink">{maintenance.memory.object_embeddings}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setPurgeTarget("attachments")}
                    disabled={purgeBusy || reindex?.running || maintenance.attachments.orphanCount === 0}
                    data-testid="purge-orphan-attachments-btn"
                    className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-40 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Purge orphan attachments
                  </button>
                  <button
                    onClick={() => setPurgeTarget("derived")}
                    disabled={purgeBusy || reindex?.running || (maintenance.memory.object_chunks === 0 && maintenance.memory.object_embeddings === 0)}
                    data-testid="purge-derived-memory-btn"
                    className="inline-flex items-center gap-2 rounded-lg border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-40 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Purge derived search data
                  </button>
                </div>

                <div className="rounded-md border border-border bg-card/40 p-3 space-y-3" data-testid="search-reindex-panel">
                  <div>
                    <p className="text-xs font-medium text-ink">Search index recovery</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      Repair processes only missing, incomplete, or older indexes. Rebuild all is useful after changing the embedding model.
                      Completed objects are detected automatically, so an interrupted repair can be resumed safely.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handleReindex(false)}
                      disabled={reindex?.running || purgeBusy || !!purgeTarget}
                      data-testid="repair-search-index-btn"
                      className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-ink hover:bg-accent disabled:opacity-40 transition-colors"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 text-primary ${reindex?.running ? "animate-spin" : ""}`} />
                      Repair missing or stale
                    </button>
                    <button
                      onClick={() => handleReindex(true)}
                      disabled={reindex?.running || purgeBusy || !!purgeTarget}
                      data-testid="rebuild-all-search-index-btn"
                      className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-ink hover:bg-accent disabled:opacity-40 transition-colors"
                    >
                      Rebuild all
                    </button>
                    {reindex?.running && (
                      <button
                        onClick={cancelReindex}
                        className="rounded-lg border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                        data-testid="cancel-search-reindex-btn"
                      >
                        Cancel after current request
                      </button>
                    )}
                  </div>

                  {reindex && (
                    <div className="space-y-2 text-[11px]" data-testid="search-reindex-progress">
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${reindex.total ? Math.round((reindex.completed / reindex.total) * 100) : reindex.running ? 0 : 100}%` }}
                        />
                      </div>
                      <p className="text-muted-foreground">
                        {reindex.currentTitle && `Processing “${reindex.currentTitle}” · `}
                        {reindex.completed}/{reindex.total} completed · {reindex.succeeded} succeeded · {reindex.failed} failed
                      </p>
                      {reindex.cancelled && <p className="text-muted-foreground">Cancelled safely; run repair again to resume.</p>}
                      {reindex.fatalError && <p className="text-destructive">{reindex.fatalError}</p>}
                      {reindex.failures?.slice(0, 3).map((failure) => (
                        <p key={failure.id} className="text-destructive">
                          {failure.title}: {failure.error}
                        </p>
                      ))}
                      {reindex.failures?.length > 3 && (
                        <p className="text-destructive">And {reindex.failures.length - 3} more failures.</p>
                      )}
                    </div>
                  )}
                </div>

                {purgeTarget && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-2" data-testid="purge-confirmation">
                    <p className="text-xs font-medium text-ink">
                      {purgeTarget === "attachments"
                        ? `Delete ${maintenance.attachments.orphanCount} unreferenced attachment files?`
                        : `Delete ${maintenance.memory.object_chunks} search chunks and ${maintenance.memory.object_embeddings} embeddings?`}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      This cannot be undone, but it does not delete source objects or immutable memory records.
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={handlePurge}
                        disabled={purgeBusy || reindex?.running}
                        data-testid="confirm-purge-btn"
                        className="inline-flex items-center gap-2 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground disabled:opacity-40"
                      >
                        {purgeBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        {purgeBusy ? "Purging…" : "Confirm purge"}
                      </button>
                      <button
                        onClick={() => setPurgeTarget(null)}
                        disabled={purgeBusy}
                        className="rounded-md border border-border px-3 py-1.5 text-xs text-ink disabled:opacity-40"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
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
