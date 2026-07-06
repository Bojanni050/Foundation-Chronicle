const STOP = new Set(["the","a","an","and","or","but","of","to","in","on","for","with","is","are","was","were","be","this","that","it","as","at","by","from","i","you","we","they","h","a"]);

function tokens(text) {
  return new Set(
    (text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w))
  );
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/**
 * Local (non-AI) relatedness: shared tags first, then text similarity across
 * title + content. Returns [{ id, score, reason }] sorted by score desc.
 */
export function findRelatedLocal(target, candidates, limit = 8) {
  if (!target) return [];
  const targetTags = new Set((target.tags || []).map((t) => t.toLowerCase()));
  const targetTokens = tokens(`${target.title} ${target.content}`);

  const results = [];
  for (const c of candidates) {
    if (!c || c.id === target.id) continue;
    const cTags = new Set((c.tags || []).map((t) => t.toLowerCase()));
    let shared = [];
    for (const t of targetTags) if (cTags.has(t)) shared.push(t);

    const textSim = jaccard(targetTokens, tokens(`${c.title} ${c.content}`));
    const score = shared.length * 1.0 + textSim * 0.8;
    if (score <= 0.02) continue;

    let reason;
    if (shared.length) {
      reason = `Shares ${shared.length === 1 ? "tag" : "tags"} #${shared.slice(0, 2).join(", #")}`;
    } else {
      reason = `Similar wording (${Math.round(textSim * 100)}%)`;
    }
    results.push({ id: c.id, object: c, score, reason });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
