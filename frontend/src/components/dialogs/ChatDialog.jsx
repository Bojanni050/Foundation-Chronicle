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
  BrainCircuit,
} from "lucide-react";
import { AIService } from "@/services/AIService";
import { getSettings } from "@/lib/settings";
import { objectRepository } from "@/repositories";
import { embedObject } from "@/services/objectEmbedding";
import { createKennisObject } from "@/services/personaSync";
import { GaiaQuickActions } from "@/components/GaiaQuickActions";
import { toast } from "sonner";

function parseSuggestions(content) {
  if (!content) return { text: "", suggestions: [] };
  const regex = /\[(?:Doorvragen|Suggestions):\s*([^\]]+)\]/i;
  const match = content.match(regex);
  if (match) {
    const rawSuggestions = match[1];
    const suggestions = rawSuggestions.split("|").map(s => s.trim()).filter(Boolean);
    const text = content.replace(regex, "").trim();
    return { text, suggestions };
  }
  return { text: content, suggestions: [] };
}

export function ChatDialog({ open, onOpenChange }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  // Stable per-session id — first message creates the "chat" object, every
  // later message updates the same one (verbatim), so a whole Gaia
  // conversation is one object, not one per exchange. Reset on clear/close
  // so the next conversation starts a fresh object rather than appending
  // to the previous one.
  const chatObjectIdRef = useRef(null);
  // Every N exchanges (Settings: "Live Gaia consolidation"), the conversation
  // so far gets scanned for persona kenmerken while still open — not just
  // once at close. Results shown live in the right-hand panel.
  const exchangeCountRef = useRef(0);
  const [extractedKenmerken, setExtractedKenmerken] = useState([]);
  const [extractedKennis, setExtractedKennis] = useState([]);
  const [showKennisPanel, setShowKennisPanel] = useState(true);
  const [consolidating, setConsolidating] = useState(false);

  const settings = getSettings();
  const activeModel = settings.models?.chat || "nousresearch/hermes-3-llama-3-8b";

  // Auto-scroll to bottom of chat when new messages appear
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, sending]);

  // Verbatim save — every exchange, not just on close, so nothing is lost
  // if the app closes mid-conversation. Cheap: IndexedDB only, no embedding
  // here (that happens once, on dialog close — see handleOpenChange below).
  const saveVerbatim = async (allMessages) => {
    const turns = allMessages.map((m) => ({ role: m.role, text: m.content }));
    const content = allMessages
      .map((m) => `${m.role === "user" ? "User" : "Gaia"}: ${m.content}`)
      .join("\n\n");

    if (!chatObjectIdRef.current) {
      const title = (allMessages[0]?.content || "Gesprek met Gaia").slice(0, 80);
      try {
        const obj = await objectRepository.create({
          type: "chat",
          title,
          content,
          tags: ["gaia"],
          source: "gaia",
          sourceProvider: "gaia",
        });
        chatObjectIdRef.current = obj.id;
      } catch (err) {
        console.error("[ChatDialog] failed to save Gaia conversation:", err);
      }
    } else {
      try {
        await objectRepository.update(chatObjectIdRef.current, { content });
      } catch (err) {
        console.error("[ChatDialog] failed to update Gaia conversation:", err);
      }
    }
    return turns;
  };

  // Embedding (chunk + whole-object) happens once per conversation, on
  // close — re-embedding after every single message would recompute the
  // same chunks over and over for no benefit while the conversation is
  // still ongoing.
  const handleOpenChange = (next) => {
    if (!next && chatObjectIdRef.current) {
      const turns = messages.map((m) => ({ role: m.role, text: m.content }));
      const content = messages
        .map((m) => `${m.role === "user" ? "User" : "Gaia"}: ${m.content}`)
        .join("\n\n");
      embedObject(chatObjectIdRef.current, turns, content).catch(() => {});
      chatObjectIdRef.current = null; // next open starts a fresh conversation object
    }
    onOpenChange(next);
  };

  // Live consolidation — scans the conversation so far (via the already-
  // saved chat object) for persona kenmerken, reusing the exact same
  // create/reinforce/resurrect pipeline as the normal background detection
  // (POST /api/persona/kenmerken). Runs every N exchanges (Settings), not
  // after every message — an LLM call each turn would be wasteful.
  const consolidateLive = async (fullHistory) => {
    const { apiUrl } = getSettings();
    if (!apiUrl || !AIService.isConfigured() || !chatObjectIdRef.current) return;
    setConsolidating(true);
    try {
      const content = fullHistory
        .map((m) => `${m.role === "user" ? "User" : "Gaia"}: ${m.content}`)
        .join("\n\n");
      const title = (fullHistory[0]?.content || "Gesprek met Gaia").slice(0, 80);

      const rejectedRes = await fetch(`${apiUrl}/api/persona/kenmerken?status=rejected`);
      const rejected = rejectedRes.ok ? await rejectedRes.json() : [];

      const candidates = await AIService.suggestPersonaKenmerken(rejected.slice(0, 20), [
        { id: chatObjectIdRef.current, type: "chat", title, content },
      ]);

      for (const c of candidates) {
        if (!c?.kenmerk || !c?.bronObjectId) continue;
        try {
          if (c.categorie === "algemeen") {
            const obj = await createKennisObject(c.kenmerk, c.bronObjectId);
            setExtractedKennis((prev) => [obj, ...prev.filter((o) => o.id !== obj.id)]);
          } else {
            const res = await fetch(`${apiUrl}/api/persona/kenmerken`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                kenmerk: c.kenmerk,
                bronObjectId: c.bronObjectId,
                soort: c.soort,
                gevoelig: c.gevoelig,
              }),
            });
            if (res.ok) {
              const saved = await res.json();
              setExtractedKenmerken((prev) => [saved, ...prev.filter((k) => k.id !== saved.id)]);
            }
          }
        } catch (err) {
          console.error("[ChatDialog] live consolidation save failed:", err);
        }
      }
    } catch (err) {
      console.error("[ChatDialog] live consolidation failed:", err);
    } finally {
      setConsolidating(false);
    }
  };

  const sendMessage = async (text) => {
    if (!text.trim() || sending) return;

    const userMessage = { role: "user", content: text.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setSending(true);

    try {
      // Gather conversation history (excluding system prompt which is injected in chatWithGaia)
      const chatHistory = [...messages, userMessage];
      const reply = await AIService.chatWithGaia(chatHistory);

      const fullHistory = [...chatHistory, { role: "assistant", content: reply }];
      setMessages(fullHistory);
      saveVerbatim(fullHistory); // best-effort, doesn't block the UI

      exchangeCountRef.current += 1;
      const n = settings.gaiaConsolidateEveryNTurns;
      if (n > 0 && exchangeCountRef.current % n === 0) {
        consolidateLive(fullHistory); // best-effort, doesn't block the UI
      }
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

  const handleSend = async (e) => {
    e.preventDefault();
    sendMessage(input);
  };

  // Quick-action shortcuts (GaiaQuickActions): a non-empty prompt sends
  // immediately — these are fixed, safe, read-only prompts, not arbitrary
  // AI-generated actions. An empty prompt (the "ask something specific"
  // shortcut) just focuses the input instead of sending anything.
  const handleQuickAction = (prompt) => {
    if (prompt) {
      sendMessage(prompt);
    } else {
      inputRef.current?.focus();
    }
  };

  const handleClear = () => {
    if (window.confirm("Are you sure you want to clear the conversation history?")) {
      setMessages([]);
      chatObjectIdRef.current = null; // the saved record stays intact — this only starts a fresh one
      exchangeCountRef.current = 0;
      setExtractedKenmerken([]);
      setExtractedKennis([]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl h-[75vh] flex p-0 overflow-hidden">
        {/* Left: chat column */}
        <div className="flex-1 min-w-0 flex flex-col p-6 overflow-hidden">
        {/* Header */}
        <DialogHeader className="border-b border-border/60 pb-3 shrink-0 flex flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="font-serif text-lg text-ink">Chat with Gaia</DialogTitle>
              <p className="text-[11px] text-muted-foreground">Interactive conversation powered by your local memory context.</p>
            </div>
          </div>
          <div className="flex items-center gap-3 pr-6">
            <div className="flex items-center gap-1.5 rounded-lg border border-border bg-accent/20 px-2.5 py-1 text-[10px] text-muted-foreground font-mono">
              <Cpu className="w-3.5 h-3.5 text-primary" />
              <span>{activeModel.replace("nousresearch/", "")}</span>
            </div>
            <button
              onClick={() => setShowKennisPanel((v) => !v)}
              className={`rounded-lg p-1.5 transition-all ${
                showKennisPanel ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-ink hover:bg-accent/40"
              }`}
              title="Toggle extracted knowledge panel"
            >
              <BrainCircuit className="w-4 h-4" />
            </button>
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
                <h4 className="font-serif text-base font-semibold text-ink">Meet Gaia</h4>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  I can answer questions, analyze concepts, or assist you with coding tasks. I automatically factor in your confirmed memory traits (e.g. your stack choices, working habits, and tech preferences) to tailor answers for you.
                </p>
              </div>
              <GaiaQuickActions onSelect={handleQuickAction} />
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg, idx) => {
                const isAssistant = msg.role === "assistant";
                const { text, suggestions } = isAssistant ? parseSuggestions(msg.content) : { text: msg.content, suggestions: [] };
                return (
                  <div key={idx} className="space-y-2">
                    <div
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
                        {text}
                      </div>
                    </div>

                    {isAssistant && suggestions.length > 0 && idx === messages.length - 1 && (
                      <div className="flex flex-wrap gap-2 pl-11 max-w-[85%]">
                        {suggestions.map((suggestion, sIdx) => (
                          <button
                            key={sIdx}
                            onClick={() => sendMessage(suggestion)}
                            disabled={sending}
                            className="text-[11px] font-sans text-primary hover:text-primary-foreground border border-primary/30 hover:border-primary hover:bg-primary/10 rounded-full px-3 py-1 bg-card transition-all active:scale-95 text-left disabled:opacity-50"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {sending && (
                <div className="flex gap-3 max-w-[85%] mr-auto items-center">
                  <div className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg bg-accent text-accent-foreground">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  </div>
                  <div className="bg-card border border-border/80 rounded-xl px-4 py-2.5 text-xs text-muted-foreground italic font-sans flex items-center gap-1.5">
                    <span>Gaia is reasoning...</span>
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
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={sending}
            placeholder={sending ? "Waiting for agent..." : "Type a message to Gaia..."}
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
        </div>

        {/* Right: extracted-knowledge panel */}
        {showKennisPanel && (
          <div className="w-72 shrink-0 border-l border-border/60 bg-accent/10 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 p-4 pb-3 border-b border-border/40 shrink-0">
              <BrainCircuit className="w-4 h-4 text-primary" />
              <h4 className="font-serif text-sm text-ink">Extracted from this chat</h4>
              {consolidating && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground ml-auto" />}
            </div>
            <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-5">
              {/* Persona knowledge — claims about the owner, subject to the
                  observation→hypothesis→confirmed trust ladder. */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  Over jou
                </p>
                {extractedKenmerken.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                    Nog niets — elke {settings.gaiaConsolidateEveryNTurns || "∞"} beurten (of bij sluiten) wordt
                    dit gesprek gescand op patronen over jou.
                  </p>
                ) : (
                  extractedKenmerken.map((k) => (
                    <div
                      key={k.id}
                      className="rounded-lg border border-border/50 bg-card/60 px-2.5 py-2 text-xs text-ink"
                    >
                      <p className="leading-snug">{k.kenmerk}</p>
                      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="rounded-full bg-accent px-1.5 py-0.5 capitalize">{k.status}</span>
                        <span>{k.soort}</span>
                        {k.gevoelig && <span className="text-amber-600">gevoelig</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* General knowledge — facts/concepts from the content itself,
                  not about the owner. No trust ladder — just kennis-objects. */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  Algemene kennis
                </p>
                {extractedKennis.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
                    Feiten/concepten uit dit gesprek die niet over jou gaan verschijnen hier als losse
                    kennis-objecten.
                  </p>
                ) : (
                  extractedKennis.map((o) => (
                    <div
                      key={o.id}
                      className="rounded-lg border border-border/50 bg-card/60 px-2.5 py-2 text-xs text-ink"
                    >
                      <p className="leading-snug">{o.content}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
