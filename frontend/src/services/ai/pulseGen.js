// Pulse — 3-5 short observation strings surfaced from a batch of objects,
// shaped by known persona traits and a disposition (skepticism/literalism/empathy).
import { getSettings } from "@/lib/settings";
import { chat, firstJsonArray } from "./core";

// `kenmerken` are above-threshold Persona traits (plain strings) — used as a
// lens on the digest, not restated as their own bullet points. `disposition`
// (skepticism/literalism/empathy, each 1-5) shapes tone and how readily
// Pulse states things as certain — same three-trait concept as Hindsight's
// Reflect, rebuilt locally rather than depending on their service.
export async function generatePulse(objects, kenmerken = [], disposition = {}) {
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
}
