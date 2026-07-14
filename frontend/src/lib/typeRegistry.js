// Plain (no-UI) registry of object types. The repository imports ONLY from here
// so the data layer has no UI dependency. Custom types are user-defined and
// stored locally in the browser (localStorage) — consistent with local-first.

const KEY = "chronicle_custom_types";

export const BUILTIN_TYPE_KEYS = [
  "note", "person", "task", "idea", "book", "project", "meeting", "dailyLog", "chat", "activity",
];

const RESERVED = new Set([...BUILTIN_TYPE_KEYS, "all", "untyped"]);

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function getCustomTypes() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new Event("chronicle-types-changed"));
}

function validateCustomTypes(list) {
  if (!Array.isArray(list)) throw new Error("Custom types must be an array");
  const seen = new Set();
  return list.map((type) => {
    if (!type || typeof type.key !== "string" || !type.key || RESERVED.has(type.key) || seen.has(type.key)) {
      throw new Error(`Invalid or duplicate custom type: ${type?.key || "unknown"}`);
    }
    seen.add(type.key);
    return {
      key: type.key,
      label: String(type.label || type.key),
      singular: String(type.singular || type.label || type.key),
      iconName: String(type.iconName || "Shapes"),
    };
  });
}

export function setCustomTypes(list) {
  const validated = validateCustomTypes(list);
  save(validated);
  return validated;
}

export function mergeCustomTypes(imported) {
  const next = new Map(getCustomTypes().map((type) => [type.key, type]));
  for (const type of validateCustomTypes(imported)) next.set(type.key, type);
  return setCustomTypes([...next.values()]);
}

export function addCustomType(label, iconName) {
  const clean = (label || "").trim();
  if (!clean) throw new Error("Type name is required");
  const base = slugify(clean);
  if (!base) throw new Error("Type name must include letters or numbers");
  const list = getCustomTypes();
  const taken = new Set([...RESERVED, ...list.map((t) => t.key)]);
  let key = base;
  let i = 2;
  while (taken.has(key)) key = `${base}-${i++}`;
  const type = { key, label: clean, singular: clean, iconName: iconName || "Shapes" };
  save([...list, type]);
  return type;
}

export function removeCustomType(key) {
  save(getCustomTypes().filter((t) => t.key !== key));
}

export function getValidTypeKeys() {
  return new Set([...BUILTIN_TYPE_KEYS, ...getCustomTypes().map((t) => t.key)]);
}
