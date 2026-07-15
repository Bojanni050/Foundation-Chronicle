import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, X, Reply, Smile } from 'lucide-react';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉', '👀'];

function newId() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`);
}

export function GaiaChat({ open, onClose }) {
  const [messages, setMessages] = useState([
    { id: newId(), role: 'assistant', text: 'Hallo! Ik ben Gaia, je persoonlijke Hermes agent. Hoe kan ik je helpen?', replyTo: null, reactions: [] }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // Which message is currently being composed as a reply — quoted above the
  // input until sent or cancelled. Purely a client-side threading affordance
  // (the flat `history` sent to Gaia is unaffected); it just gives replies a
  // visible parent in this UI, the way Slack/Discord-style threads do.
  const [replyingTo, setReplyingTo] = useState(null);
  // Which message currently has its quick-reaction row open (hover-revealed
  // on desktop, but kept as click-state too so it works on touch).
  const [reactionPickerFor, setReactionPickerFor] = useState(null);
  const endOfMessagesRef = useRef(null);

  // Gaia's backend (Hermes) exposes no "thinking" vs "using a tool" event —
  // stream_callback only ever fires with text deltas, nothing distinguishes
  // tool execution from the API. What IS reliable: no text streams in while
  // a tool call is running (only actual token generation produces deltas),
  // so a silence gap *after* streaming has already started is a real signal
  // something other than typing is happening, not a guess dressed up as one.
  const [activityPhase, setActivityPhase] = useState(null); // null | 'thinking' | 'streaming' | 'paused'
  const lastDeltaAtRef = useRef(0);
  const hasStreamedRef = useRef(false);

  useEffect(() => {
    if (!isLoading) {
      setActivityPhase(null);
      return;
    }
    const PAUSE_THRESHOLD_MS = 1800;
    const tick = () => {
      if (!hasStreamedRef.current) {
        setActivityPhase('thinking');
      } else if (Date.now() - lastDeltaAtRef.current > PAUSE_THRESHOLD_MS) {
        setActivityPhase('paused');
      } else {
        setActivityPhase('streaming');
      }
    };
    tick();
    const id = setInterval(tick, 400);
    return () => clearInterval(id);
  }, [isLoading]);

  // Dragging state
  const [pos, setPos] = useState({ x: window.innerWidth - 380, y: Math.max(20, window.innerHeight - 800) });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, initialX: 0, initialY: 0 });

  // Initial positioning on open
  useEffect(() => {
    if (open && pos.x === window.innerWidth - 380) {
      setPos({ x: window.innerWidth - 400, y: Math.max(40, window.innerHeight - 850) });
    }
  }, [open, pos.x]);

  useEffect(() => {
    if (endOfMessagesRef.current) {
      endOfMessagesRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open]);

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e) => {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPos({
        x: dragRef.current.initialX + dx,
        y: dragRef.current.initialY + dy
      });
    };

    const handlePointerUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isDragging]);

  const handlePointerDown = (e) => {
    // Voorkom draggen als je op de sluitknop klikt
    if (e.target.closest('button')) return;

    e.preventDefault();
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: pos.x,
      initialY: pos.y
    };
  };

  const toggleReaction = (messageId, emoji) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== messageId) return m;
      const has = (m.reactions || []).includes(emoji);
      return { ...m, reactions: has ? m.reactions.filter(r => r !== emoji) : [...(m.reactions || []), emoji] };
    }));
  };

  if (!open) return null;

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    const history = messages.map(({ role, text }) => ({ role, text }));
    const replyToId = replyingTo?.id || null;
    setInput('');
    setReplyingTo(null);
    setMessages(prev => [...prev, { id: newId(), role: 'user', text: userText, replyTo: replyToId, reactions: [] }]);
    setIsLoading(true);

    const assistantMessageId = newId();
    setMessages(prev => [...prev, { id: assistantMessageId, role: 'assistant', text: '', replyTo: null, reactions: [] }]);
    hasStreamedRef.current = false;
    lastDeltaAtRef.current = Date.now();

    const updateAssistantText = (text) => {
      setMessages(prev => prev.map(m => (m.id === assistantMessageId ? { ...m, text } : m)));
    };
    // Every actual content chunk resets the silence clock — see the
    // activityPhase effect above for why this is the signal we use.
    const markDelta = (text) => {
      hasStreamedRef.current = true;
      lastDeltaAtRef.current = Date.now();
      updateAssistantText(text);
    };

    try {
      const response = await fetch('http://localhost:4577/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userText,
          history
        })
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body available');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let finalText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const line = part.trim();
          if (!line) continue;
          if (!line.startsWith('{')) continue;

          try {
            const payload = JSON.parse(line);
            if (typeof payload?.delta === 'string') {
              finalText += payload.delta;
              markDelta(finalText);
            } else if (typeof payload?.response === 'string') {
              finalText = payload.response;
              markDelta(finalText);
            }
          } catch (_err) {
            // Ignore non-JSON chunks and keep streaming.
          }
        }
      }

      if (buffer.trim()) {
        try {
          const payload = JSON.parse(buffer.trim());
          if (typeof payload?.response === 'string') {
            finalText = payload.response;
            updateAssistantText(finalText);
          }
        } catch (_err) {
          // Ignore trailing non-JSON content.
        }
      }
    } catch (err) {
      console.error('Gaia Chat Error:', err);
      updateAssistantText(`Oeps, er ging iets mis: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const findMessage = (id) => messages.find(m => m.id === id);

  return (
    <div
      className="fixed w-80 h-[80vh] bg-background border border-border shadow-2xl rounded-2xl flex flex-col z-50 overflow-hidden"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Header (Draggable) */}
      <div
        className={`flex items-center justify-between p-4 border-b border-border bg-muted/30 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={handlePointerDown}
      >
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
          <h3 className="font-semibold text-foreground tracking-wide select-none">Gaia</h3>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-muted cursor-pointer z-10">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          const parent = msg.replyTo ? findMessage(msg.replyTo) : null;
          const isActiveAssistantMsg = !isUser && isLoading && msg === messages[messages.length - 1];
          // The streaming assistant message starts as an empty bubble — show
          // status in its place instead of a separate indicator, so the
          // bubble itself visibly hands off between phases.
          const isTypingPlaceholder = isActiveAssistantMsg && activityPhase === 'thinking';
          const isPaused = isActiveAssistantMsg && activityPhase === 'paused';

          return (
            <div key={msg.id} className={`group flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isUser ? 'bg-primary/20 text-primary' : 'bg-muted text-foreground'}`}>
                {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
              </div>
              <div className={`flex flex-col gap-1 max-w-[80%] ${isUser ? 'items-end' : 'items-start'}`}>
                {parent && (
                  <div className={`text-[11px] text-muted-foreground/70 border-l-2 border-border pl-1.5 truncate max-w-[220px] ${isUser ? 'self-end text-right border-l-0 border-r-2 pr-1.5 pl-0' : ''}`}>
                    ↪ {parent.text.slice(0, 60) || '…'}
                  </div>
                )}
                <div
                  data-testid={`gaia-msg-${msg.id}`}
                  className={`text-sm py-2 px-3 rounded-2xl whitespace-pre-wrap ${
                    isUser
                      ? 'bg-primary text-primary-foreground rounded-tr-sm'
                      : 'bg-muted/50 text-foreground rounded-tl-sm border border-border'
                  }`}
                >
                  {isTypingPlaceholder ? (
                    <span className="flex items-center gap-1.5 py-0.5 text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                        <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                        <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce"></span>
                      </span>
                      <span className="text-xs italic">Denkt na...</span>
                    </span>
                  ) : (
                    <>
                      {msg.text}
                      {isPaused && (
                        <span
                          data-testid="gaia-paused-indicator"
                          className="mt-1 flex items-center gap-1 text-xs italic text-muted-foreground/70"
                        >
                          <span className="w-1 h-1 bg-foreground/40 rounded-full animate-pulse"></span>
                          Gebruikt mogelijk een tool of denkt verder na...
                        </span>
                      )}
                    </>
                  )}
                </div>

                {msg.reactions?.length > 0 && (
                  <div className={`flex flex-wrap gap-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
                    {msg.reactions.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => toggleReaction(msg.id, emoji)}
                        title="Verwijder reactie"
                        className="text-xs bg-accent/60 hover:bg-accent rounded-full px-1.5 py-0.5 transition-colors"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}

                {/* Hover actions: reply + react, hidden until the row is hovered */}
                {!isTypingPlaceholder && (
                  <div className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                    <button
                      onClick={() => setReplyingTo(msg)}
                      title="Beantwoorden"
                      data-testid={`gaia-reply-${msg.id}`}
                      className="p-1 rounded text-muted-foreground/70 hover:text-primary hover:bg-accent/50 transition-colors"
                    >
                      <Reply className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setReactionPickerFor(reactionPickerFor === msg.id ? null : msg.id)}
                      title="Reageer"
                      data-testid={`gaia-react-${msg.id}`}
                      className="p-1 rounded text-muted-foreground/70 hover:text-primary hover:bg-accent/50 transition-colors"
                    >
                      <Smile className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {reactionPickerFor === msg.id && (
                  <div className="flex items-center gap-1 rounded-full border border-border bg-background px-1.5 py-1 shadow-sm">
                    {QUICK_REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => { toggleReaction(msg.id, emoji); setReactionPickerFor(null); }}
                        className="text-sm hover:scale-125 transition-transform"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={endOfMessagesRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="border-t border-border bg-background">
        {replyingTo && (
          <div className="flex items-center justify-between gap-2 px-3 pt-2 text-[11px] text-muted-foreground">
            <span className="truncate">
              ↪ Antwoord op: <span className="text-foreground/80">{replyingTo.text.slice(0, 50) || '…'}</span>
            </span>
            <button type="button" onClick={() => setReplyingTo(null)} className="shrink-0 hover:text-foreground transition-colors">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        <div className="relative flex items-center p-3">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Vraag iets aan Gaia..."
            className="w-full bg-muted/30 border border-border rounded-full pl-4 pr-10 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:bg-background transition-colors"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="absolute right-4 w-8 h-8 flex items-center justify-center bg-primary text-primary-foreground rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
          >
            <Send className="w-4 h-4 ml-0.5" />
          </button>
        </div>
      </form>
    </div>
  );
}
