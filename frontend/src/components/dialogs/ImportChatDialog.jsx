import { useRef, useState } from "react";
import { Upload, Loader2, FileText } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { objectRepository } from "@/repositories";
import { parseChat, keywordTags } from "@/services/chatParser";
import { AIService } from "@/services/AIService";

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
  const [msg, setMsg] = useState("");
  const fileRef = useRef(null);

  const importObjects = async (entries) => {
    setBusy(true);
    setMsg("");
    let created = 0;
    for (const { text, provider } of entries) {
      if (!text.trim()) continue;
      const parsed = parseChat(text);
      const tags = await autoTags(parsed.content);
      await objectRepository.create({
        type: "chat",
        title: parsed.title,
        content: parsed.content,
        tags,
        source: "import",
        sourceProvider: parsed.sourceProvider || provider || null,
      });
      created++;
    }
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
    const entries = await Promise.all(
      files.map(
        (f) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ text: String(reader.result || ""), provider: null });
            reader.readAsText(f);
          })
      )
    );
    await importObjects(entries);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="import-dialog">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Import chat</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="paste">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="paste" data-testid="import-tab-paste">Paste text</TabsTrigger>
            <TabsTrigger value="upload" data-testid="import-tab-upload">Upload files</TabsTrigger>
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
        </Tabs>
        {msg && <p className="text-xs text-destructive" data-testid="import-msg">{msg}</p>}
      </DialogContent>
    </Dialog>
  );
}
