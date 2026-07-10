import { useState, useRef, useEffect, useCallback } from "react";
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
  Bot,
  X,
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

function GaiaAvatar({ size = "md" }) {
  const sz = size === "xs" ? "h-4 w-4" : size === "sm" ? "h-8 w-8" : "h-14 w-14";
  return (
    <img
      src="/gaia-avatar.jpg"
      alt="Gaia"
      className={`${sz} rounded-md object-cover object-top shrink-0 shadow-sm`}
    />
  );
}

// ─── Individual chat pane (reused for Gaia main + each specialist tab) ────────
function ChatPane({ tabId, isGaia, specialistName, onSendMessage, messages, sending, onClear, onQuickAction, inputRef }) {
  const scrollRef = useRef(null);
  const [input, setInput] = useState("");

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, sending]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!input.trim() || sending) return;
    onSendMessage(tabId, input.trim());
    setInput("");
  };

  const handleSuggestion = (suggestion) => {
    onSendMessage(tabId, suggestion);
  };

  const placeholder = sending
    ? "Waiting for response..."
    : isGaia
    ? "Type a message to Gaia..."
    : `Ask ${specialistName}...`;

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Message Stream */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4 no-scrollbar bg-background/25 rounded-xl border border-border/30 px-3">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
            {isGaia ? (
              <div className="rounded-full bg-primary/5 p-1 text-primary">
                <GaiaAvatar size="md" />
              </div>
            ) : (
              <div className="rounded-full bg-primary/5 p-4 text-primary animate-pulse">
                <Bot className="w-8 h-8" />
              </div>
            )}
            <div className="space-y-1.5 max-w-sm">
              <h4 className="font-serif text-base font-semibold text-ink">
                {isGaia ? "Meet Gaia" : `${specialistName} Specialist`}
              </h4>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {isGaia
                  ? "I can answer questions, analyze concepts, or assist you with coding tasks. I automatically factor in your confirmed memory traits to tailor answers for you."
                  : `Direct conversation with your ${specialistName} specialist. Questions are answered using this specialist's dedicated context and system prompt.`}
              </p>
            </div>
            {isGaia && <GaiaQuickActions onSelect={onQuickAction} />}
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, idx) => {
              const isAssistant = msg.role === "assistant";
              const { text, suggestions } = isAssistant
                ? parseSuggestions(msg.content)
                : { text: msg.content, suggestions: [] };
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
                          : ""
                      }`}
                    >
                      {msg.role === "user"
                        ? <User className="w-4 h-4" />
                        : isGaia
                        ? <GaiaAvatar size="sm" />
                        : <div className="h-8 w-8 flex items-center justify-center rounded-lg bg-accent text-accent-foreground"><Bot className="w-4 h-4" /></div>}
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
                          onClick={() => handleSuggestion(suggestion)}
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
                  {isGaia
                    ? <GaiaAvatar size="sm" />
                    : <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                </div>
                <div className="bg-card border border-border/80 rounded-xl px-4 py-2.5 text-xs text-muted-foreground italic font-sans flex items-center gap-1.5">
                  <span>{isGaia ? "Gaia is reasoning..." : `${specialistName} is thinking...`}</span>
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
          placeholder={placeholder}
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
  );
}

// ─── Main ChatDialog ──────────────────────────────────────────────────────────
const GAIA_TAB = "__gaia__";

export function ChatDialog({ open, onOpenChange }) {
  // Tab state — each tab: { id, label, isGaia, specialistName?, messages[] }
  const [tabs, setTabs] = useState([
    { id: GAIA_TAB, label: "Gaia", isGaia: true, messages: [] },
  ]);
  const [activeTab, setActiveTab] = useState(GAIA_TAB);
  const [sending, setSending] = useState(false);

  const inputRef = useRef(null);
  const chatObjectIdRef = useRef(null);
  const exchangeCountRef = useRef(0);

  const [extractedKenmerken, setExtractedKenmerken] = useState([]);
  const [extractedKennis, setExtractedKennis] = useState([]);
  const [showKennisPanel, setShowKennisPanel] = useState(true);
  const [consolidating, setConsolidating] = useState(false);

  const settings = getSettings();
  const activeModel = settings.models?.chat || "nousresearch/hermes-3-llama-3-8b";

  const getTabMessages = (tabId) =>
    tabs.find((t) => t.id === tabId)?.messages || [];

  const setTabMessages = (tabId, updater) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === tabId
          ? { ...t, messages: typeof updater === "function" ? updater(t.messages) : updater }
          : t
      )
    );
  };

  // ── Open a specialist tab (idempotent — focus if already open) ─────────────
  const openSpecialistTab = useCallback((specialistName) => {
    const tabId = `specialist:${specialistName}`;
    setTabs((prev) => {
      if (prev.find((t) => t.id === tabId)) return prev;
      return [
        ...prev,
        { id: tabId, label: specialistName, isGaia: false, specialistName, messages: [] },
      ];
    });
    setActiveTab(tabId);
  }, []);

  // ── Close a specialist tab ─────────────────────────────────────────────────
  const closeTab = (tabId) => {
    if (tabId === GAIA_TAB) return; // Gaia main is permanent
    setTabs((prev) => prev.filter((t) => t.id !== tabId));
    // Switch back to Gaia (or previous tab)
    setActiveTab(GAIA_TAB);
  };

  // ── Verbatim save (Gaia tab only) ─────────────────────────────────────────
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

  const handleOpenChange = (next) => {
    if (!next && chatObjectIdRef.current) {
      const gaiaMessages = getTabMessages(GAIA_TAB);
      const turns = gaiaMessages.map((m) => ({ role: m.role, text: m.content }));
      const content = gaiaMessages
        .map((m) => `${m.role === "user" ? "User" : "Gaia"}: ${m.content}`)
        .join("\n\n");
      embedObject(chatObjectIdRef.current, turns, content).catch(() => {});
      chatObjectIdRef.current = null;
    }
    onOpenChange(next);
  };

  // ── Live consolidation ────────────────────────────────────────────────────
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

  // ── Send message (routes to Gaia or specialist chat based on tabId) ────────
  const sendMessage = async (tabId, text) => {
    if (!text.trim() || sending) return;
    setSending(true);

    const userMessage = { role: "user", content: text };
    setTabMessages(tabId, (prev) => [...prev, userMessage]);

    try {
      const currentMessages = getTabMessages(tabId);
      const chatHistory = [...currentMessages, userMessage];

      let reply;
      if (tabId === GAIA_TAB) {
        reply = await AIService.chatWithGaia(chatHistory);
      } else {
        // Direct specialist call
        const tab = tabs.find((t) => t.id === tabId);
        reply = await AIService.chatWithSpecialist(tab.specialistName, chatHistory);
      }

      const fullHistory = [...chatHistory, { role: "assistant", content: reply }];
      setTabMessages(tabId, fullHistory);

      if (tabId === GAIA_TAB) {
        saveVerbatim(fullHistory);
        exchangeCountRef.current += 1;
        const n = settings.gaiaConsolidateEveryNTurns;
        if (n > 0 && exchangeCountRef.current % n === 0) {
          consolidateLive(fullHistory);
        }
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

  const handleClear = () => {
    if (!window.confirm("Clear this conversation history?")) return;
    setTabMessages(activeTab, []);
    if (activeTab === GAIA_TAB) {
      chatObjectIdRef.current = null;
      exchangeCountRef.current = 0;
      setExtractedKenmerken([]);
      setExtractedKennis([]);
    }
  };

  const handleQuickAction = (prompt) => {
    if (prompt) sendMessage(GAIA_TAB, prompt);
    else inputRef.current?.focus();
  };

  const activeTabData = tabs.find((t) => t.id === activeTab) || tabs[0];
  const currentMessages = activeTabData?.messages || [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl h-[75vh] flex p-0 overflow-hidden">

        {/* ── Left: chat column ─────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col p-6 overflow-hidden">

          {/* Header */}
          <DialogHeader className="border-b border-border/60 pb-3 shrink-0">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl overflow-hidden bg-primary/10">
                  <GaiaAvatar size="sm" />
                </div>
                <div>
                  <DialogTitle className="font-serif text-lg text-ink">Chat with Gaia</DialogTitle>
                  <p className="text-[11px] text-muted-foreground">
                    Interactive conversation powered by your local memory context.
                  </p>
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
                {currentMessages.length > 0 && (
                  <button
                    onClick={handleClear}
                    className="rounded-lg p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/5 transition-all"
                    title="Clear chat history"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* ── Tab bar (only visible when specialist tabs are open) ─── */}
            {tabs.length > 1 && (
              <div className="flex items-center gap-1 mt-3 overflow-x-auto no-scrollbar">
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={`group relative flex items-center gap-1.5 rounded-t-lg px-3 py-1.5 text-[11px] font-medium cursor-pointer transition-all select-none ${
                      activeTab === tab.id
                        ? "bg-background border border-b-background border-border/60 text-ink -mb-px z-10"
                        : "bg-accent/30 text-muted-foreground hover:text-ink hover:bg-accent/50"
                    }`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.isGaia ? (
                      <GaiaAvatar size="xs" />
                    ) : (
                      <Bot className="w-3 h-3 text-primary/70" />
                    )}
                    <span className="max-w-[120px] truncate">{tab.label}</span>

                    {/* ✕ close button — only for specialist tabs */}
                    {!tab.isGaia && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(tab.id);
                        }}
                        className="ml-0.5 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-destructive/15 hover:text-destructive text-muted-foreground transition-all"
                        title={`Close ${tab.label} chat`}
                        aria-label={`Close ${tab.label} tab`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </DialogHeader>

          {/* ── Chat pane for active tab ─────────────────────────────────── */}
          <div className="flex-1 min-h-0 flex flex-col pt-4 overflow-hidden">
            <ChatPane
              key={activeTab}
              tabId={activeTab}
              isGaia={activeTabData?.isGaia ?? true}
              specialistName={activeTabData?.specialistName}
              messages={currentMessages}
              sending={sending}
              onSendMessage={sendMessage}
              onClear={handleClear}
              onQuickAction={handleQuickAction}
              inputRef={activeTabData?.isGaia ? inputRef : null}
            />
          </div>
        </div>

        {/* ── Right: extracted-knowledge panel ─────────────────────────── */}
        {showKennisPanel && (
          <div className="w-72 shrink-0 border-l border-border/60 bg-accent/10 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 p-4 pb-3 border-b border-border/40 shrink-0">
              <BrainCircuit className="w-4 h-4 text-primary" />
              <h4 className="font-serif text-sm text-ink">Extracted from this chat</h4>
              {consolidating && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground ml-auto" />}
            </div>
            <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-5">
              {/* Persona knowledge */}
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

              {/* General knowledge */}
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
