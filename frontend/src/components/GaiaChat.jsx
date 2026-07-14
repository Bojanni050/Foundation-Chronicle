import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, X } from 'lucide-react';

export function GaiaChat({ open, onClose }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', text: 'Hallo! Ik ben Gaia, je persoonlijke Hermes agent. Hoe kan ik je helpen?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const endOfMessagesRef = useRef(null);

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

  if (!open) return null;

  const handleSend = async (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    const history = messages.map(({ role, text }) => ({ role, text }));
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userText }]);
    setIsLoading(true);

    const assistantMessageIndex = messages.length + 1;
    setMessages(prev => [...prev, { role: 'assistant', text: '' }]);

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
              setMessages(prev => {
                const next = [...prev];
                next[assistantMessageIndex] = { ...next[assistantMessageIndex], text: finalText };
                return next;
              });
            } else if (typeof payload?.response === 'string') {
              finalText = payload.response;
              setMessages(prev => {
                const next = [...prev];
                next[assistantMessageIndex] = { ...next[assistantMessageIndex], text: finalText };
                return next;
              });
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
            setMessages(prev => {
              const next = [...prev];
              next[assistantMessageIndex] = { ...next[assistantMessageIndex], text: finalText };
              return next;
            });
          }
        } catch (_err) {
          // Ignore trailing non-JSON content.
        }
      }
    } catch (err) {
      console.error('Gaia Chat Error:', err);
      setMessages(prev => {
        const next = [...prev];
        next[assistantMessageIndex] = { ...next[assistantMessageIndex], text: `Oeps, er ging iets mis: ${err.message}` };
        return next;
      });
    } finally {
      setIsLoading(false);
    }
  };

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
        {messages.map((msg, idx) => (
          <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-primary/20 text-primary' : 'bg-muted text-foreground'}`}>
              {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>
            <div className={`text-sm py-2 px-3 rounded-2xl max-w-[80%] whitespace-pre-wrap ${
              msg.role === 'user' 
                ? 'bg-primary text-primary-foreground rounded-tr-sm' 
                : 'bg-muted/50 text-foreground rounded-tl-sm border border-border'
            }`}>
              {msg.text}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex gap-3 flex-row">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-muted text-foreground">
              <Bot className="w-4 h-4" />
            </div>
            <div className="text-sm py-2 px-3 rounded-2xl bg-muted/50 text-foreground rounded-tl-sm border border-border flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
              <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
              <span className="w-1.5 h-1.5 bg-foreground/40 rounded-full animate-bounce"></span>
            </div>
          </div>
        )}
        <div ref={endOfMessagesRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="p-3 border-t border-border bg-background">
        <div className="relative flex items-center">
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
            className="absolute right-1.5 w-8 h-8 flex items-center justify-center bg-primary text-primary-foreground rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
          >
            <Send className="w-4 h-4 ml-0.5" />
          </button>
        </div>
      </form>
    </div>
  );
}
