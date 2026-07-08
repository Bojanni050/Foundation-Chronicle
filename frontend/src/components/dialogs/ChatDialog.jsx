import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MessageSquare,
  Send,
  Sparkles,
  User,
  Trash2,
  Cpu,
  Loader2,
} from "lucide-react";
import { AIService } from "@/services/AIService";
import { getSettings } from "@/lib/settings";
import { toast } from "sonner";

export function ChatDialog({ open, onOpenChange }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  const settings = getSettings();
  const activeModel = settings.models?.chat || "nousresearch/hermes-3-llama-3-8b";

  // Auto-scroll to bottom of chat when new messages appear
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, sending]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || sending) return;

    const userMessage = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setSending(true);

    try {
      // Gather conversation history (excluding system prompt which is injected in chatWithHermes)
      const chatHistory = [...messages, userMessage];
      const reply = await AIService.chatWithHermes(chatHistory);

      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      console.error(err);
      toast.error(
        err.message === "NO_KEY"
          ? "API Key missing. Add your OpenRouter key in Settings."
          : "Could not fetch agent response. Please try again."
      );
    } finally {
      setSending(false);
    }
  };

  const handleClear = () => {
    if (window.confirm("Are you sure you want to clear the conversation history?")) {
      setMessages([]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[75vh] flex flex-col p-6 overflow-hidden">
        {/* Header */}
        <DialogHeader className="border-b border-border/60 pb-3 shrink-0 flex flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="font-serif text-lg text-ink">Chat with Hermes</DialogTitle>
              <p className="text-[11px] text-muted-foreground">Interactive conversation powered by your local memory context.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 pr-6">
            <div className="flex items-center gap-1.5 rounded-lg border border-border bg-accent/20 px-2.5 py-1 text-[10px] text-muted-foreground font-mono">
              <Cpu className="w-3.5 h-3.5 text-primary" />
              <span>{activeModel.replace("nousresearch/", "")}</span>
            </div>
            {messages.length > 0 && (
              <button
                onClick={handleClear}
                className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-all"
                title="Clear chat history"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </DialogHeader>

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4 no-scrollbar bg-background/25 rounded-xl border border-border/30 px-3">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
              <div className="rounded-full bg-primary/5 p-4 text-primary animate-pulse">
                <Sparkles className="w-8 h-8" />
              </div>
              <div className="space-y-1.5 max-w-sm">
                <h4 className="font-serif text-base font-semibold text-ink">Meet Hermes</h4>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  I can answer questions, analyze concepts, or assist you with coding tasks. I automatically factor in your confirmed memory traits (e.g. your stack choices, working habits, and tech preferences) to tailor answers for you.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex gap-3 max-w-[85%] ${
                    msg.role === "user" ? "ml-auto flex-row-reverse" : "mr-auto"
                  }`}
                >
                  {/* Avatar */}
                  <div
                    className={`h-8 w-8 shrink-0 flex items-center justify-center rounded-lg text-xs font-semibold ${
                      msg.role === "user"
                        ? "bg-primary/20 text-primary"
                        : "bg-accent text-accent-foreground"
                    }`}
                  >
                    {msg.role === "user" ? <User className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                  </div>

                  {/* Bubble */}
                  <div
                    className={`rounded-xl px-4 py-2.5 text-xs leading-relaxed shadow-sm ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground font-sans font-medium"
                        : "bg-card border border-border/80 text-ink font-sans whitespace-pre-wrap"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {sending && (
                <div className="flex gap-3 max-w-[85%] mr-auto items-center">
                  <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  </div>
                  <div className="bg-card border border-border/80 rounded-xl px-4 py-2.5 text-xs text-muted-foreground italic font-sans flex items-center gap-1.5">
                    <span>Hermes is reasoning...</span>
                  </div>
                </div>
              )}
              <div ref={scrollRef} />
            </div>
          )}
        </div>

        {/* Input Bar */}
        <form onSubmit={handleSend} className="pt-3 border-t border-border/60 shrink-0 flex items-center gap-2.5">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
            placeholder={sending ? "Waiting for agent..." : "Type a message to Hermes..."}
            className="flex-1 rounded-xl border border-border bg-background/50 px-4 py-2.5 text-xs text-ink focus:outline-none focus:border-primary/50 focus:bg-background transition-all disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded-xl bg-ink p-2.5 text-background hover:bg-ink/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
