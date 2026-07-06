const STOP = new Set(["the","a","an","and","or","but","of","to","in","on","for","with","is","are","was","were","be","this","that","it","as","at","by","from","i","you","we","they"]);

function truncate(s, n = 80) {
  s = (s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n).trim() + "…" : s;
}

function formatTurns(turns) {
  return turns
    .map((t) => `${t.role === "assistant" ? "A" : "H"}: ${(t.text || "").trim()}`)
    .join("\n\n");
}

function titleFromTurns(turns, fallbackTitle) {
  if (fallbackTitle && fallbackTitle.trim()) return truncate(fallbackTitle, 90);
  const firstUser = turns.find((t) => t.role !== "assistant");
  return truncate(firstUser ? firstUser.text : "Imported chat", 90);
}

// Claude.ai export: { name, chat_messages: [{ sender, text | content:[{text}] }] }
function tryClaude(data) {
  const conv = Array.isArray(data) ? data[0] : data;
  if (!conv || !Array.isArray(conv.chat_messages)) return null;
  const turns = conv.chat_messages.map((m) => ({
    role: m.sender === "assistant" ? "assistant" : "user",
    text:
      m.text ||
      (Array.isArray(m.content)
        ? m.content.map((c) => c.text || "").join("\n")
        : ""),
  }));
  if (!turns.length) return null;
  return {
    title: titleFromTurns(turns, conv.name),
    content: formatTurns(turns),
    sourceProvider: "claude",
  };
}

// ChatGPT export: { title, mapping: { id: { message: { author:{role}, content:{parts} } } } }
function tryChatGPT(data) {
  const conv = Array.isArray(data) ? data[0] : data;
  if (!conv || !conv.mapping || typeof conv.mapping !== "object") return null;
  const nodes = Object.values(conv.mapping)
    .filter((n) => n && n.message && n.message.author)
    .map((n) => n.message);
  const turns = nodes
    .map((m) => {
      const role = m.author.role === "assistant" ? "assistant" : "user";
      let text = "";
      const c = m.content;
      if (c && Array.isArray(c.parts)) {
        text = c.parts
          .map((p) => (typeof p === "string" ? p : p && p.text ? p.text : ""))
          .join("\n");
      } else if (typeof c === "string") {
        text = c;
      }
      return { role, text, ts: m.create_time || 0 };
    })
    .filter((t) => t.text && t.text.trim() && t.role !== "system")
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (!turns.length) return null;
  return {
    title: titleFromTurns(turns, conv.title),
    content: formatTurns(turns),
    sourceProvider: "chatgpt",
  };
}

// Plain pasted conversation: detect "H:/A:", "Human:/Assistant:", "You:/ChatGPT:" etc
function parsePlain(text) {
  const lines = (text || "").split(/\r?\n/);
  const turns = [];
  let current = null;
  const roleRe = /^\s*(you|human|user|me|h|q|prompt)\s*[:>-]\s*/i;
  const asstRe = /^\s*(assistant|ai|chatgpt|claude|gemini|gpt|a|answer|bot)\s*[:>-]\s*/i;
  for (const line of lines) {
    if (asstRe.test(line)) {
      if (current) turns.push(current);
      current = { role: "assistant", text: line.replace(asstRe, "") };
    } else if (roleRe.test(line)) {
      if (current) turns.push(current);
      current = { role: "user", text: line.replace(roleRe, "") };
    } else if (current) {
      current.text += "\n" + line;
    } else if (line.trim()) {
      current = { role: "user", text: line };
    }
  }
  if (current) turns.push(current);

  if (turns.length >= 2) {
    return {
      title: titleFromTurns(turns),
      content: formatTurns(turns),
      sourceProvider: null,
    };
  }
  // fallback: store raw content unchanged
  return {
    title: truncate(text, 90) || "Imported chat",
    content: (text || "").trim(),
    sourceProvider: null,
  };
}

/**
 * Parse a chat file/paste into { title, content, sourceProvider }.
 * Tries Claude JSON, then ChatGPT JSON, then plain-text conversation.
 */
export function parseChat(text) {
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (data) {
    return tryClaude(data) || tryChatGPT(data) || parsePlain(text);
  }
  return parsePlain(text);
}

export function keywordTags(text, n = 4) {
  const words = (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}
