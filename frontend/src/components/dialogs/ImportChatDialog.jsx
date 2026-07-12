import { useEffect, useRef, useState } from "react";
import { Upload, Loader2, FileText, Play, Square } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getSettings } from "@/lib/settings";
import { objectRepository } from "@/repositories";
import { parseChat, keywordTags } from "@/services/chatParser";
import { embedObject } from "@/services/objectEmbedding";
import { AIService } from "@/services/AIService";
import { contentHash } from "@/lib/contentHash";

async function autoTags(text) {
  if (AIService.isConfigured()) {
    try {
      return await AIService.suggestTags(text);
    } catch {
      /* fall through */
    }
  }
  return keywordTags(text);
}

export function ImportChatDialog({ open, onOpenChange, onImported }) {
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [msg, setMsg] = useState("");
  const fileRef = useRef(null);

  // Bulk-import tab state — polls the Chronicle backend, which owns the
  // actual Python/Playwright subprocess (see server/chatgptImportManager.js).
  const [bulkLimit, setBulkLimit] = useState("");
  const [bulkStatus, setBulkStatus] = useState({ running: false, lines: [] });
  const [bulkError, setBulkError] = useState("");
  const bulkLogRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const { apiUrl } = getSettings();
        const res = await fetch(`${apiUrl}/api/settings/chatgpt-import/status`);
        if (res.ok && !cancelled) setBulkStatus(await res.json());
      } catch {
        /* local server may be unreachable — just try again next tick */
      }
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [open]);

  useEffect(() => {
    bulkLogRef.current?.scrollTo({ top: bulkLogRef.current.scrollHeight });
  }, [bulkStatus.lines]);

  const startBulkImport = async () => {
    setBulkError("");
    try {
      const { apiUrl } = getSettings();
      const res = await fetch(`${apiUrl}/api/settings/chatgpt-import/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: bulkLimit ? Number(bulkLimit) : undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setBulkError(body.reason === "already_running" ? "Already running." : "Could not start.");
        return;
      }
      setBulkStatus((s) => ({ ...s, running: true }));
    } catch {
      setBulkError("Can't reach local server. Is `npm run server` running?");
    }
  };

  const stopBulkImport = async () => {
    try {
      const { apiUrl } = getSettings();
      await fetch(`${apiUrl}/api/settings/chatgpt-import/stop`, { method: "POST" });
    } catch {
      /* ignore */
    }
  };

  const importObjects = async (entries) => {
    setBusy(true);
    setMsg("");
    let created = 0;
    const total = entries.length;

    // Atomically claim any items queued in the inbox (extension-imported)
        // and process them as part of this import batch. Using POST /claim
        // instead of GET prevents the race where inboxSync claims items between
        // our read and our create loop — the claim is atomic, so exactly one
        // caller (us or inboxSync) ever gets each item.
        let inboxEntries = [];
        try {
          const { apiUrl } = getSettings();
          if (apiUrl) {
            const res = await fetch(`${apiUrl}/api/inbox/claim`, { method: "POST" });
            if (res.ok) {
              const inbox = await res.json();
              if (Array.isArray(inbox)) {
                inboxEntries = inbox.map((it) => ({
                  text: it.content || "",
                  filename: it.title || "Inbox item",
                  provider: it.sourceProvider || it.source || null,
                }));
              }
            }
          }
        } catch { /* local server may be unreachable */ }

        // Combine inbox entries with the user's paste/files so they're all
        // processed together in one pass
        const allEntries = [...inboxEntries, ...entries];
        const totalAll = allEntries.length;

        for (let i = 0; i < totalAll; i++) {
      const { text, filename, provider } = entries[i];
      if (!text.trim()) continue;

      const fileLabel = filename ? `"${filename}"` : `chat ${i + 1}`;

      setStatusText(`[${i + 1}/${total}] Parsing structure of ${fileLabel}...`);
      const parsed = parseChat(text);

      setStatusText(`[${i + 1}/${total}] Analyzing content and generating tags for ${fileLabel}...`);
      const tags = await autoTags(parsed.content);

      // Skip if an object with the same content hash already exists
      // in IndexedDB or is queued in the inbox (extension-imported)
      const hash = contentHash(parsed.content);
      const existing = await objectRepository.findByContentHash(hash);
      if (existing || inboxHashes.has(hash)) {
        created++;
        continue;
      }

      setStatusText(`[${i + 1}/${total}] Saving ${fileLabel} to your database...`);
      const obj = await objectRepository.create({
        type: "chat",
        title: parsed.title,
        content: parsed.content,
        tags,
        source: "import",
        sourceProvider: parsed.sourceProvider || provider || null,
        occurredAt: parsed.occurredAt || null,
        turns: Array.isArray(parsed.turns) ? parsed.turns : [],
      });
      // Best-effort message/object-level embedding — doesn't block the import
      // if the local server or the embedding model isn't available.
      embedObject(obj.id, parsed.turns, obj.content);
      created++;
    }

    setStatusText("");
    setBusy(false);
    if (created > 0) {
      onImported(created);
      onOpenChange(false);
      setPaste("");
    } else {
      setMsg("Nothing to import — paste text or choose files.");
    }
  };

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setBusy(true);
    setStatusText("Reading uploaded files...");
    const entries = await Promise.all(
      files.map(
        (f) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ text: String(reader.result || ""), filename: f.name, provider: null });
            reader.readAsText(f);
          })
      )
    );
    await importObjects(entries);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overflow-hidden" data-testid="import-dialog">
        {busy && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm p-6">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <div className="text-center space-y-2 max-w-[80%]">
              <p className="text-sm font-semibold text-ink">Importing your chats</p>
              <p className="text-xs text-muted-foreground/80 animate-pulse font-sans leading-relaxed">
                {statusText || "Starting import..."}
              </p>
            </div>
          </div>
        )}
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Import chat</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="paste">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="paste" data-testid="import-tab-paste">Paste text</TabsTrigger>
            <TabsTrigger value="upload" data-testid="import-tab-upload">Upload files</TabsTrigger>
            <TabsTrigger value="bulk" data-testid="import-tab-bulk">ChatGPT bulk</TabsTrigger>
          </TabsList>

          <TabsContent value="paste" className="mt-4 space-y-3">
            <textarea
              data-testid="import-paste-input"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={"Paste a conversation… e.g.\n\nYou: How do I…\nAssistant: You can…"}
              className="h-52 w-full resize-none rounded-xl border border-border bg-card/50 p-3 text-sm text-ink placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 no-scrollbar"
            />
            <button
              onClick={() => importObjects([{ text: paste, provider: null }])}
              disabled={busy || !paste.trim()}
              data-testid="import-paste-btn"
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink py-2.5 text-sm font-medium text-background hover:bg-ink/90 disabled:opacity-40 transition-colors"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
              Import as chat
            </button>
          </TabsContent>

          <TabsContent value="upload" className="mt-4 space-y-3">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              data-testid="import-upload-zone"
              className="flex h-52 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
            >
              {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" strokeWidth={1.5} />}
              <span className="text-sm">Choose .json / .txt / .md files</span>
              <span className="text-xs text-muted-foreground/70">Claude & ChatGPT exports supported · bulk allowed</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".json,.txt,.md,application/json,text/plain,text/markdown"
              className="hidden"
              data-testid="import-file-input"
              onChange={(e) => handleFiles(e.target.files)}
            />
          </TabsContent>

          <TabsContent value="bulk" className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground/80 leading-relaxed">
              Drives a real logged-in browser through your whole ChatGPT sidebar history and imports every
              conversation. First run opens a visible Chrome window to log in — after that it's cached and
              can run in the background. See <code>tools/chatgpt_bulk_import/README.md</code>.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                value={bulkLimit}
                onChange={(e) => setBulkLimit(e.target.value)}
                disabled={bulkStatus.running}
                placeholder="All conversations"
                data-testid="bulk-limit-input"
                className="w-40 rounded-lg border border-border bg-card/50 px-3 py-2 text-sm text-ink placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/40 disabled:opacity-40"
              />
              {bulkStatus.running ? (
                <button
                  onClick={stopBulkImport}
                  data-testid="bulk-stop-btn"
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-destructive py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
                >
                  <Square className="w-4 h-4" />
                  Stop
                </button>
              ) : (
                <button
                  onClick={startBulkImport}
                  data-testid="bulk-start-btn"
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-ink py-2 text-sm font-medium text-background hover:bg-ink/90 transition-colors"
                >
                  <Play className="w-4 h-4" />
                  Start bulk import
                </button>
              )}
            </div>
            {bulkError && <p className="text-xs text-destructive" data-testid="bulk-error">{bulkError}</p>}
            <div
              ref={bulkLogRef}
              data-testid="bulk-log"
              className="h-40 w-full overflow-y-auto rounded-xl border border-border bg-card/50 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground"
            >
              {bulkStatus.lines?.length ? (
                bulkStatus.lines.map((l, i) => (
                  <div key={i} className={l.stream === "stderr" ? "text-destructive/80" : undefined}>
                    {l.text}
                  </div>
                ))
              ) : (
                <span className="text-muted-foreground/50">No activity yet.</span>
              )}
            </div>
          </TabsContent>
        </Tabs>
        {msg && <p className="text-xs text-destructive" data-testid="import-msg">{msg}</p>}
      </DialogContent>
    </Dialog>
  );
}