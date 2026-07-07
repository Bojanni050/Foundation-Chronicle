import { getSettings } from "@/lib/settings";
import { keywordTags } from "@/services/chatParser";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

async function chat(messages, extra = {}, model, context = "unknown") {
  const { openrouterKey, models } = getSettings();
  if (!openrouterKey) throw new Error("NO_KEY");
  const activeModel = model || models.tagging;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openrouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin,
      "X-Title": "Chronicle",
    },
    body: JSON.stringify({ model: activeModel, messages, ...extra }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`AI_ERROR ${res.status} ${t.slice(0, 120)}`);
  }
  const data = await res.json();

  // Track stats
  try {
    const usage = data.usage;
    if (usage) {
      const promptTokens = usage.prompt_tokens || 0;
      const completionTokens = usage.completion_tokens || 0;

      // Estimate prices based on cached list in local storage
      let promptPrice = 0.07;
      let completionPrice = 0.21;

      const { getCachedOpenRouterModels } = await import("./openrouterModels");
      const { models: cachedList } = getCachedOpenRouterModels();
      const matchedModel = cachedList.find((m) => m.id === activeModel);
      if (matchedModel) {
        promptPrice = matchedModel.promptPer1M || 0;
        completionPrice = matchedModel.completionPer1M || 0;
      }

      const cost = (promptTokens * promptPrice + completionTokens * completionPrice) / 1000000;

      const STATS_KEY = "chronicle_token_stats";
      let stats = {
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalCost: 0,
        calls: [],
      };

      const raw = localStorage.getItem(STATS_KEY);
      if (raw) {
        try {
          stats = JSON.parse(raw);
        } catch {}
      }

      stats.totalPromptTokens = (stats.totalPromptTokens || 0) + promptTokens;
      stats.totalCompletionTokens = (stats.totalCompletionTokens || 0) + completionTokens;
      stats.totalCost = (stats.totalCost || 0) + cost;

      const callRecord = {
        timestamp: new Date().toISOString(),
        context,
        model: activeModel,
        promptTokens,
        completionTokens,
        cost,
      };

      stats.calls = [callRecord, ...(stats.calls || [])].slice(0, 50);
      localStorage.setItem(STATS_KEY, JSON.stringify(stats));
    }
  } catch (err) {
    console.error("Failed to track token statistics:", err.message);
  }

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
      model,
      "test"
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
      models.tagging,
      "tagging"
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
      models.weave,
      "weave"
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
      models.persona,
      "persona"
    );
    const arr = firstJsonArray(out);
    if (!arr) throw new Error("BAD_RESPONSE");
    return arr;
  },

  // `kenmerken` are above-threshold Persona traits (plain strings) — used as a
  // lens on the digest, not restated as their own bullet points. `disposition`
  // (skepticism/literalism/empathy, each 1-5) shapes tone and how readily
  // Pulse states things as certain — same three-trait concept as Hindsight's
  // Reflect, rebuilt locally rather than depending on their service.
  async generatePulse(objects, kenmerken = [], disposition = {}) {
    const { models } = getSettings();
    const { skepticism = 3, literalism = 3, empathy = 3 } = disposition;
    const digest = objects
      .slice(0, 60)
      .map((o) => `- [${o.type}] ${o.title} (tags: ${(o.tags || []).join(", ") || "none"})`)
      .join("\n");
    const kenmerkenBlock = kenmerken.length
      ? `\n\nKNOWN TRAITS ABOUT THE OWNER (use as a lens on the objects below, don't just restate them):\n${kenmerken
          .map((k) => `- ${k}`)
          .join("\n")}`
      : "";
    const dispositionBlock =
      `\n\nDISPOSITION (1-5 scale, shape your tone and confidence accordingly):\n` +
      `- Skepticism ${skepticism}: ${skepticism >= 4 ? "hedge claims, ask what the actual evidence is rather than stating things as certain" : skepticism <= 2 ? "state observations plainly and confidently" : "balanced, mention uncertainty only when genuinely thin"}.\n` +
      `- Literalism ${literalism}: ${literalism >= 4 ? "stick to what's explicitly there, avoid reading between the lines" : literalism <= 2 ? "feel free to interpret and connect dots that aren't explicitly stated" : "balanced interpretation"}.\n` +
      `- Empathy ${empathy}: ${empathy >= 4 ? "consider emotional/personal context, warmer tone" : empathy <= 2 ? "stay detached and fact-focused" : "balanced tone"}.`;
    const out = await chat(
      [
        {
          role: "system",
          content:
            "You are a calm assistant surfacing gentle insights about a personal knowledge base. Return ONLY a JSON array of 3-5 short observation strings (e.g. mentions, themes, gaps). No prose outside the array.",
        },
        { role: "user", content: `Objects:\n${digest}${kenmerkenBlock}${dispositionBlock}` },
      ],
      { max_tokens: 300, temperature: 0.4 },
      models.pulse,
      "pulse"
    );
    const arr = firstJsonArray(out);
    if (!arr || !arr.length) throw new Error("BAD_RESPONSE");
    return arr.map((s) => String(s));
  },

  // Analyzes temporal evolution of the user's persona over a timeline of events.
  async reflectTemporalBeliefs(existingKenmerken, temporalObjects) {
    const { models } = getSettings();
    
    const existingList = existingKenmerken
      .map((k) => `${k.id} :: "${k.kenmerk}" (status: ${k.status}, active since: ${k.validFrom || k.createdAt})`)
      .join("\n") || "(none yet)";
      
    const eventsList = temporalObjects
      .map((o) => {
        const time = o.occurredAt 
          ? new Date(o.occurredAt).toLocaleDateString() 
          : (o.temporalText || new Date(o.createdAt).toLocaleDateString());
        return `[${time}] [${o.type}] ${o.title}\n${(o.content || "").slice(0, 400)}`;
      })
      .join("\n\n");

    const out = await chat(
      [
        {
          role: "system",
          content:
            "You are a temporal reflection layer that studies the history of a user's knowledge archive (their 'persona') to track how their habits, preferences, and beliefs have evolved over time.\n\n" +
            "You are given a list of KNOWN TRAITS (active or rejected) and a chronological list of TEMPORAL EVENTS.\n\n" +
            "Analyze the timeline of events. For each trait in the KNOWN TRAITS, determine if it has changed, been replaced, or was only valid during a specific timeframe. Also identify if new habits/beliefs have emerged.\n\n" +
            "You can output two types of actions:\n" +
            "1. 'update': Update an existing trait because it was only valid in the past, has been replaced, or has a specific duration. Set validTo (ISO string) and temporalText (e.g. 'Winter 2025'). If it has been replaced, set status to 'rejected', provide a verwerpReden explaining the replacement, and set vervangenByTemporaryId to point to the temporaryId of the new replacing trait.\n" +
            "2. 'create': Create a new trait representing the new evolved habit/belief. Set validFrom (ISO string), temporalText (e.g. 'since June'), and specify a temporaryId (e.g. 'temp_1') if this trait is a replacement for an old one.\n\n" +
            "Return ONLY a JSON array of reflection action objects. Do not wrap in a parent object, return the array directly. Example: [{\"action\": \"create\", ...}, ...]. Return an empty array [] if there is no temporal evolution or change. No prose.",
        },
        { role: "user", content: `KNOWN TRAITS:\n${existingList}\n\nTEMPORAL EVENTS:\n${eventsList}` },
      ],
      { max_tokens: 800, temperature: 0.2 },
      models.persona,
      "reflection"
    );

    const arr = firstJsonArray(out);
    if (!arr) return [];
    return arr;
  },

  getTokenStats() {
    const STATS_KEY = "chronicle_token_stats";
    try {
      const raw = localStorage.getItem(STATS_KEY);
      return raw ? JSON.parse(raw) : { totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0, calls: [] };
    } catch {
      return { totalPromptTokens: 0, totalCompletionTokens: 0, totalCost: 0, calls: [] };
    }
  },

  clearTokenStats() {
    const STATS_KEY = "chronicle_token_stats";
    localStorage.removeItem(STATS_KEY);
  }
};

export { keywordTags };
