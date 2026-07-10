// Tag suggestion — 2-4 concise topical tags for a piece of content.
import { getSettings } from "@/lib/settings";
import { chat, firstJsonArray } from "./core";

// Returns 2-4 tags. Throws on failure so caller can fall back to keywords.
export async function suggestTags(content) {
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
}
