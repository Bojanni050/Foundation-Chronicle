const STOP = new Set(["the","a","an","and","or","but","of","to","in","on","for","with","is","are","was","were","be","this","that","it","as","at","by","from","i","you","we","they","h","a"]);

const tokenCache = new WeakMap();

function tokens(text) {
  // If it's not a string or too short, compute normally
  if (typeof text !== "string" || text.length < 5) return createTokens(text);
  
  // Since we don't have the object here, we can't WeakMap the object easily inside tokens().
  // Let's just create a regular tokens function, but change findRelatedLocal to cache.
  return createTokens(text);
}

function createTokens(text) {
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
export function findRelatedLocal(target, candidates, limit = 8, cache = null) {
  if (!target) return [];
  const targetTags = new Set((target.tags || []).map((t) => t.toLowerCase()));
  
  let targetTokens;
  if (cache && cache.has(target.id)) {
    targetTokens = cache.get(target.id).tokens;
  } else {
    targetTokens = createTokens(`${target.title} ${target.content}`);
    if (cache) cache.set(target.id, { tags: targetTags, tokens: targetTokens });
  }

  const results = [];
  for (const c of candidates) {
    if (!c || c.id === target.id) continue;
    
    let cTags;
    let cTokens;
    if (cache && cache.has(c.id)) {
      const cached = cache.get(c.id);
      cTags = cached.tags;
      cTokens = cached.tokens;
    } else {
      cTags = new Set((c.tags || []).map((t) => t.toLowerCase()));
      cTokens = createTokens(`${c.title} ${c.content}`);
      if (cache) cache.set(c.id, { tags: cTags, tokens: cTokens });
    }

    let shared = [];
    for (const t of targetTags) if (cTags.has(t)) shared.push(t);

    const textSim = jaccard(targetTokens, cTokens);
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
