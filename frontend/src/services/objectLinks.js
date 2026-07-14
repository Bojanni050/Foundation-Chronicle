export function normalizeObjectLinks(links, currentId = null) {
  const seen = new Set();
  const normalized = [];
  for (const id of Array.isArray(links) ? links : []) {
    if (typeof id !== "string" || !id || id === currentId || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

export function backlinksFor(objects, targetId) {
  if (!targetId) return [];
  return (Array.isArray(objects) ? objects : [])
    .filter((object) => object?.id && object.id !== targetId && normalizeObjectLinks(object.links, object.id).includes(targetId))
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export function linkCandidates(objects, { currentId, linkedIds = [], query = "", limit = 6 } = {}) {
  const linked = new Set(normalizeObjectLinks(linkedIds, currentId));
  const needle = query.trim().toLowerCase();

  return (Array.isArray(objects) ? objects : [])
    .filter((object) => object?.id && object.id !== currentId && !linked.has(object.id))
    .map((object) => {
      const title = (object.title || "").toLowerCase();
      const tags = (object.tags || []).join(" ").toLowerCase();
      const content = (object.content || "").toLowerCase();
      const type = (object.type || "untyped").toLowerCase();
      const haystack = `${title} ${tags} ${content} ${type}`;
      let score = 0;
      if (!needle) score = 1;
      else if (title === needle) score = 5;
      else if (title.startsWith(needle)) score = 4;
      else if (title.includes(needle)) score = 3;
      else if (tags.includes(needle)) score = 2;
      else if (haystack.includes(needle)) score = 1;
      return { object, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || (b.object.updatedAt || "").localeCompare(a.object.updatedAt || ""))
    .slice(0, limit)
    .map(({ object }) => object);
}
