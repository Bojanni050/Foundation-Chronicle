function withinDays(iso, days) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Date.now() - t <= days * 24 * 60 * 60 * 1000;
}

/**
 * Rule-based digest fallback (no AI). Returns array of short strings.
 */
export function rulePulse(objects) {
  const out = [];
  const total = objects.length;
  if (total === 0) {
    return ["Your stack is empty — capture a thought to begin."];
  }

  const newThisWeek = objects.filter((o) => withinDays(o.createdAt, 7));
  const chatsThisWeek = newThisWeek.filter((o) => o.type === "chat");
  const untagged = objects.filter((o) => !o.tags || o.tags.length === 0);

  out.push(`${total} object${total === 1 ? "" : "s"} in your stack.`);
  if (newThisWeek.length) out.push(`${newThisWeek.length} new this week.`);
  if (chatsThisWeek.length) out.push(`${chatsThisWeek.length} chat${chatsThisWeek.length === 1 ? "" : "s"} imported this week.`);
  if (untagged.length) out.push(`${untagged.length} object${untagged.length === 1 ? "" : "s"} still untagged — a good moment to tidy up.`);

  // most-used tag
  const freq = {};
  for (const o of objects) for (const t of o.tags || []) freq[t] = (freq[t] || 0) + 1;
  const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] > 1) out.push(`You return to #${top[0]} often (${top[1]} objects).`);

  return out;
}
