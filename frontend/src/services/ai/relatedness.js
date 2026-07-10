// Relatedness — picks up to 6 related object ids for a focus note, optionally
// lensed through known persona traits about the owner.
import { getSettings } from "@/lib/settings";
import { chat, firstJsonArray } from "./core";

export async function findRelated(object, candidates, kenmerken = []) {
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
}
