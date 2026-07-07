import { getSettings } from "@/lib/settings";
import { keywordTags } from "@/services/chatParser";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

async function chat(messages, extra = {}, model) {
  const { openrouterKey, models } = getSettings();
  if (!openrouterKey) throw new Error("NO_KEY");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin,
      "X-Title": "Chronicle",
    },
    body: JSON.stringify({ model: model || models.tagging, messages, ...extra }),
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

  async test(model) {
    const out = await chat(
      [{ role: "user", content: "Reply with the single word: ok" }],
      { max_tokens: 5 },
      model
    );
    return { ok: true, sample: out.trim() };
  },

  // Returns 2-4 tags. Throws on failure so caller can fall back to keywords.
  async suggestTags(content) {
    const { models } = getSettings();
    const out = await chat(
      [
        {
          role: "system",
          content:
            "You extract concise topical tags. Return ONLY a JSON array of 2-4 short lowercase tag strings, no prose.",
        },
        { role: "user", content: (content || "").slice(0, 4000) },
      ],
      { max_tokens: 60, temperature: 0.2 },
      models.tagging
    );
    const arr = firstJsonArray(out);
    if (!arr || !arr.length) throw new Error("BAD_RESPONSE");
    return arr
      .map((t) => String(t).toLowerCase().replace(/^#/, "").trim())
      .filter(Boolean)
      .slice(0, 4);
  },

  // Optional smarter relatedness. Returns array of ids.
  async findRelated(object, candidates, kenmerken = []) {
    const { models } = getSettings();
    const list = candidates
      .slice(0, 40)
      .map((c) => `${c.id} :: ${c.title}`)
      .join("\n");
    const kenmerkenBlock = kenmerken.length
      ? `\n\nKNOWN TRAITS ABOUT THE OWNER (use as context/lens to evaluate relevance):\n${kenmerken
          .map((k) => `- ${k}`)
          .join("\n")}`
      : "";
    const out = await chat(
      [
        {
          role: "system",
          content:
            "Given a focus note, a list of candidate objects (id :: title), and optional traits about the owner, pick up to 6 ids most related. Return ONLY a JSON array of id strings.",
        },
        {
          role: "user",
          content: `FOCUS: ${object.title}\n${(object.content || "").slice(0, 1500)}${kenmerkenBlock}\n\nCANDIDATES:\n${list}`,
        },
      ],
      { max_tokens: 200, temperature: 0.2 },
      models.weave
    );
    return firstJsonArray(out) || [];
  },

  // Given recently rejected persona kenmerken and a batch of objects, returns candidate
  // patterns evidenced by a specific object — each proposing a new candidate trait.
  async suggestPersonaKenmerken(rejectedKenmerken, objects) {
    const { models } = getSettings();
    const rejectedList =
      rejectedKenmerken.map((k) => `- ${k.kenmerk}`).join("\n") || "(none)";
    const objectList = objects
      .map((o) => `${o.id} :: [${o.type || "untyped"}] ${o.title}\n${(o.content || "").slice(0, 500)}`)
      .join("\n\n");
    const out = await chat(
      [
        {
          role: "system",
          content:
            "You study a personal knowledge archive to infer stable, recurring information about its owner (a " +
            "'persona'). You are given a batch of objects (notes/tasks/chats) and a list of patterns to avoid. " +
            "For each object in the batch, identify at most one stable, recurring fact or pattern about the owner's " +
            "persona that is clearly evidenced by that specific object. Never invent one that isn't evidenced by the " +
            "given object.\n\n" +
            'Classify each candidate\'s "soort": "feit" for something stated once as simply true (a name, a ' +
            "physical attribute, an explicitly stated preference — \"loves jazz\"), or \"patroon\" for something " +
            "only inferable from repeated behavior (writing habits, recurring themes). Set \"gevoelig\": true only " +
            "for patroon candidates that are personality judgments about the owner's character (e.g. " +
            '"impatient", "perfectionist") — these are more sensitive than plain behavioral habits and should ' +
            "always require the owner's explicit confirmation, never automatic use.\n\n" +
            "CRITICAL: Do not suggest any pattern that is semantically similar to the patterns in the DO NOT SUGGEST list.\n\n" +
            'Return ONLY a JSON array of {"kenmerk": string, "soort": "feit"|"patroon", "gevoelig": boolean, ' +
            '"bronObjectId": string}. Return an empty array if nothing stands out.',
        },
        { role: "user", content: `DO NOT SUGGEST THESE PATTERNS (previously rejected by the user):\n${rejectedList}\n\nOBJECTS:\n${objectList}` },
      ],
      { max_tokens: 500, temperature: 0.2 },
      models.persona
    );
    const arr = firstJsonArray(out);
    if (!arr) throw new Error("BAD_RESPONSE");
    return arr;
  },

  // `kenmerken` are above-threshold Persona traits (plain strings) — used as a
  // lens on the digest, not restated as their own bullet points.
  async generatePulse(objects, kenmerken = []) {
    const { models } = getSettings();
    const digest = objects
      .slice(0, 60)
      .map((o) => `- [${o.type}] ${o.title} (tags: ${(o.tags || []).join(", ") || "none"})`)
      .join("\n");
    const kenmerkenBlock = kenmerken.length
      ? `\n\nKNOWN TRAITS ABOUT THE OWNER (use as a lens on the objects below, don't just restate them):\n${kenmerken
          .map((k) => `- ${k}`)
          .join("\n")}`
      : "";
    const out = await chat(
      [
        {
          role: "system",
          content:
            "You are a calm assistant surfacing gentle insights about a personal knowledge base. Return ONLY a JSON array of 3-5 short observation strings (e.g. mentions, themes, gaps). No prose outside the array.",
        },
        { role: "user", content: `Objects:\n${digest}${kenmerkenBlock}` },
      ],
      { max_tokens: 300, temperature: 0.4 },
      models.pulse
    );
    const arr = firstJsonArray(out);
    if (!arr || !arr.length) throw new Error("BAD_RESPONSE");
    return arr.map((s) => String(s));
  },
};

export { keywordTags };
