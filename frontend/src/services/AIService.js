import { getSettings } from "@/lib/settings";
import { keywordTags } from "@/services/chatParser";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

async function chat(messages, extra = {}) {
  const { openrouterKey, model } = getSettings();
  if (!openrouterKey) throw new Error("NO_KEY");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin,
      "X-Title": "Chronicle",
    },
    body: JSON.stringify({ model, messages, ...extra }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`AI_ERROR ${res.status} ${t.slice(0, 120)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

function firstJsonArray(text) {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

export const AIService = {
  isConfigured() {
    return !!getSettings().openrouterKey;
  },

  async test() {
    const out = await chat(
      [{ role: "user", content: "Reply with the single word: ok" }],
      { max_tokens: 5 }
    );
    return { ok: true, sample: out.trim() };
  },

  // Returns 2-4 tags. Throws on failure so caller can fall back to keywords.
  async suggestTags(content) {
    const out = await chat(
      [
        {
          role: "system",
          content:
            "You extract concise topical tags. Return ONLY a JSON array of 2-4 short lowercase tag strings, no prose.",
        },
        { role: "user", content: (content || "").slice(0, 4000) },
      ],
      { max_tokens: 60, temperature: 0.2 }
    );
    const arr = firstJsonArray(out);
    if (!arr || !arr.length) throw new Error("BAD_RESPONSE");
    return arr
      .map((t) => String(t).toLowerCase().replace(/^#/, "").trim())
      .filter(Boolean)
      .slice(0, 4);
  },

  // Optional smarter relatedness. Returns array of ids.
  async findRelated(object, candidates) {
    const list = candidates
      .slice(0, 40)
      .map((c) => `${c.id} :: ${c.title}`)
      .join("\n");
    const out = await chat(
      [
        {
          role: "system",
          content:
            "Given a focus note and a list of candidate objects (id :: title), pick up to 6 ids most related. Return ONLY a JSON array of id strings.",
        },
        {
          role: "user",
          content: `FOCUS: ${object.title}\n${(object.content || "").slice(0, 1500)}\n\nCANDIDATES:\n${list}`,
        },
      ],
      { max_tokens: 200, temperature: 0.2 }
    );
    return firstJsonArray(out) || [];
  },

  async generatePulse(objects) {
    const digest = objects
      .slice(0, 60)
      .map((o) => `- [${o.type}] ${o.title} (tags: ${(o.tags || []).join(", ") || "none"})`)
      .join("\n");
    const out = await chat(
      [
        {
          role: "system",
          content:
            "You are a calm assistant surfacing gentle insights about a personal knowledge base. Return ONLY a JSON array of 3-5 short observation strings (e.g. mentions, themes, gaps). No prose outside the array.",
        },
        { role: "user", content: `Objects:\n${digest}` },
      ],
      { max_tokens: 300, temperature: 0.4 }
    );
    const arr = firstJsonArray(out);
    if (!arr || !arr.length) throw new Error("BAD_RESPONSE");
    return arr.map((s) => String(s));
  },
};

export { keywordTags };
