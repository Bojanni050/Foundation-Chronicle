import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Activity,
  CheckCircle,
  HelpCircle,
  Clock,
  Sparkles,
  Search,
  Eye,
  Check,
  RotateCw,
  ArrowRight,
  Monitor,
  Mic,
  FileText,
  Plus,
} from "lucide-react";
import { AIService } from "@/services/AIService";
import { toast } from "sonner";
import { getSettings } from "@/lib/settings";

export function ImportScreenpipeDialog({ open, onOpenChange, onAddObjects }) {
  const [hours, setHours] = useState(2);
  const [contentType, setContentType] = useState("all"); // all | ocr | audio
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [extracted, setExtracted] = useState([]); // Array of { type, title, content, tags, selected }
  const [step, setStep] = useState("setup"); // setup | results

  const handleScan = async () => {
    setLoading(true);
    setStatusText("Connecting to Screenpipe...");
    setExtracted([]);
    
    try {
      const { apiUrl } = getSettings();
      const res = await fetch(
        `${apiUrl}/api/screenpipe/search?hours=${hours}&contentType=${contentType}`
      );
      
      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }
      
      const data = await res.json();
      
      setStatusText("Reading screen recording OCR & audio data...");
      let textBlocks = [];
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.content) {
            if (item.content.text) textBlocks.push(item.content.text);
            if (item.content.transcription) textBlocks.push(item.content.transcription);
          }
        }
      }

      if (textBlocks.length === 0) {
        toast.warning("No OCR or audio transcripts found in the specified timeframe.");
        setLoading(false);
        return;
      }

      setStatusText(`Found ${textBlocks.length} records. Synthesizing concepts with AI...`);
      const combinedText = textBlocks.join("\n");
      const items = await AIService.extractFromScreenpipe(combinedText);
      
      if (!Array.isArray(items) || items.length === 0) {
        toast.info("AI analyzed the screen history but found no distinct tasks or ideas.");
        setLoading(false);
        return;
      }

      // Map to items with selected: true
      setExtracted(items.map((it) => ({ ...it, selected: true })));
      setStep("results");
    } catch (err) {
      console.error(err);
      toast.error(
        "Could not load Screenpipe data. Make sure Screenpipe is running on port 3030."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSelect = (index) => {
    setExtracted((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, selected: !item.selected } : item))
    );
  };

  const handleFieldChange = (index, field, value) => {
    setExtracted((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, [field]: value } : item))
    );
  };

  const handleImport = () => {
    const toImport = extracted.filter((e) => e.selected);
    if (toImport.length === 0) {
      toast.warning("No items selected for import.");
      return;
    }

    onAddObjects(
      toImport.map((item) => ({
        type: item.type,
        title: item.title,
        content: item.content,
        tags: Array.isArray(item.tags) ? item.tags : [],
      }))
    );

    toast.success(`Imported ${toImport.length} objects from Screenpipe!`);
    onOpenChange(false);
    // Reset dialog
    setStep("setup");
    setExtracted([]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[80vh] flex flex-col p-6 overflow-hidden">
        <DialogHeader className="border-b border-border/60 pb-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-500">
              <Monitor className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="font-serif text-lg text-ink">Import from Screenpipe</DialogTitle>
              <p className="text-[11px] text-muted-foreground">Ambient intelligence: parse notes and tasks from your screen activity.</p>
            </div>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-12 space-y-4">
            <RotateCw className="w-8 h-8 text-primary animate-spin" />
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-ink">{statusText}</p>
              <p className="text-[11px] text-muted-foreground">Analyzing local database history (OCR + Audio)</p>
            </div>
          </div>
        ) : step === "setup" ? (
          <div className="flex-1 overflow-y-auto py-4 space-y-6">
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-ink font-serif">How it works</h4>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Screenpipe records your screen OCR and audio transcribing locally. Chronicle queries your local Screenpipe database for the chosen timeframe, filters the text elements, and extracts structured ideas, notes, or todo items.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Timeframe to Scan</label>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 4, 8].map((h) => (
                    <button
                      key={h}
                      onClick={() => setHours(h)}
                      className={`rounded-lg border p-2.5 text-center text-xs font-medium transition-all ${
                        hours === h
                          ? "border-primary bg-primary/5 text-primary font-semibold"
                          : "border-border bg-card text-muted-foreground hover:bg-accent/40"
                      }`}
                    >
                      {h} {h === 1 ? "hour" : "hours"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Content Sources</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "all", label: "Screen & Audio", icon: Monitor },
                    { id: "ocr", label: "Screen OCR only", icon: FileText },
                    { id: "audio", label: "Audio only", icon: Mic },
                  ].map((src) => {
                    const Icon = src.icon;
                    return (
                      <button
                        key={src.id}
                        onClick={() => setContentType(src.id)}
                        className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center text-xs font-medium transition-all ${
                          contentType === src.id
                            ? "border-primary bg-primary/5 text-primary font-semibold"
                            : "border-border bg-card text-muted-foreground hover:bg-accent/40"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{src.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <button
              onClick={handleScan}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink py-2.5 text-xs font-semibold text-background hover:bg-ink/90 transition-colors mt-4"
            >
              Scan local Screenpipe history
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto py-4 space-y-4 no-scrollbar">
              <p className="text-xs text-muted-foreground">
                AI extracted the following items. Review, edit, and check items to import:
              </p>

              <div className="space-y-3">
                {extracted.map((item, idx) => (
                  <div
                    key={idx}
                    className={`rounded-xl border p-4 transition-all ${
                      item.selected
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border bg-card/60 opacity-60"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={() => handleToggleSelect(idx)}
                        className="mt-1 h-3.5 w-3.5 rounded border-border text-primary focus:ring-primary shrink-0"
                      />
                      <div className="flex-1 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <select
                            value={item.type}
                            onChange={(e) => handleFieldChange(idx, "type", e.target.value)}
                            className="bg-transparent border-0 font-serif text-xs font-semibold text-primary focus:ring-0 focus:outline-none"
                          >
                            <option value="note">Note</option>
                            <option value="task">Task</option>
                            <option value="idea">Idea</option>
                          </select>
                          <span className="text-[10px] text-muted-foreground/70">
                            {(item.tags || []).map((t) => `#${t}`).join(" ")}
                          </span>
                        </div>
                        <input
                          type="text"
                          value={item.title}
                          onChange={(e) => handleFieldChange(idx, "title", e.target.value)}
                          className="w-full bg-transparent font-serif text-xs font-semibold text-ink border-b border-transparent focus:border-border focus:outline-none py-0.5"
                        />
                        <textarea
                          rows={2}
                          value={item.content}
                          onChange={(e) => handleFieldChange(idx, "content", e.target.value)}
                          className="w-full bg-transparent text-[11px] leading-relaxed text-muted-foreground border-b border-transparent focus:border-border focus:outline-none resize-none"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-border/60 pt-3 flex items-center justify-between gap-3 shrink-0">
              <button
                onClick={() => setStep("setup")}
                className="rounded-lg border border-border px-4 py-2 text-xs text-muted-foreground hover:bg-accent/40 transition-colors"
              >
                Back to Settings
              </button>
              <button
                onClick={handleImport}
                className="flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-background hover:bg-ink/90 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Import Selected
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
