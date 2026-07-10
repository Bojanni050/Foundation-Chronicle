// Discovers Hermes skills available to Gaia's self-contained backend and
// persists which ones are enabled. New skills default to disabled — Gaia
// must never gain a capability silently just because Hermes picked it up.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const GAIA_HERMES_HOME = path.join(__dirname, ".hermes-home");
const SETTINGS_FILE = path.join(GAIA_HERMES_HOME, "enabled-skills.json");

function humanize(name) {
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function readSkillDescription(skillDir) {
  for (const filename of ["SKILL.md", "skill.md"]) {
    try {
      const text = fs.readFileSync(path.join(skillDir, filename), "utf8");
      const description = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("#") && !line.startsWith("---"));
      if (description) return description.slice(0, 240);
    } catch {
      // Try the next conventional entrypoint.
    }
  }
  return "Hermes skill";
}

function hasSkillFile(dir) {
  return fs.existsSync(path.join(dir, "SKILL.md")) || fs.existsSync(path.join(dir, "skill.md"));
}

function toSkill(dir, name) {
  return { name, label: humanize(name), description: readSkillDescription(dir) };
}

// Skills can sit either directly under root (root/<name>/SKILL.md — how
// `hermes skills install` places a flat, hub-installed skill like
// "humanizer") or one level deeper inside a category folder
// (root/<category>/<name>/SKILL.md — how bundled skills are grouped, e.g.
// "software-development/foundation-chronicle-conventions"). A folder is
// only treated as a category if it has no SKILL.md of its own; a category
// folder with nothing installed under it yet (just its own DESCRIPTION.md)
// correctly yields no skills. Only one extra level deep on purpose — deep
// enough for every layout seen so far, without turning this into an
// unbounded directory walk.
function scanSkillDirectory(root) {
  if (!root || !fs.existsSync(root)) return [];
  const results = [];
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const entryPath = path.join(root, entry.name);
      if (hasSkillFile(entryPath)) {
        results.push(toSkill(entryPath, entry.name));
        continue;
      }
      try {
        for (const sub of fs.readdirSync(entryPath, { withFileTypes: true })) {
          if (!sub.isDirectory()) continue;
          const subPath = path.join(entryPath, sub.name);
          if (hasSkillFile(subPath)) {
            results.push(toSkill(subPath, sub.name));
          }
        }
      } catch {
        // entryPath not readable as a directory — skip it, not a category.
      }
    }
  } catch {
    return [];
  }
  return results;
}

function parseCliSkillList(output) {
  const text = String(output || "").trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : parsed.skills;
    if (Array.isArray(rows)) {
      return rows
        .map((row) => typeof row === "string" ? { name: row } : row)
        .filter((row) => row?.name)
        .map((row) => ({
          name: row.name,
          label: row.label || humanize(row.name),
          description: row.description || "Hermes skill",
        }));
    }
  } catch {
    // Fall through to the text parser.
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s*/, "").split(/\s{2,}|\t/)[0].trim())
    .filter((name) => /^[a-z0-9][a-z0-9_-]*$/i.test(name))
    .map((name) => ({ name, label: humanize(name), description: "Hermes skill" }));
}

function discoverViaCli() {
  const commands = [
    ["skills", "list", "--json"],
    ["skills", "list"],
  ];
  for (const args of commands) {
    try {
      const output = execFileSync("hermes", args, {
        env: { ...process.env, HERMES_HOME: GAIA_HERMES_HOME },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
        shell: process.platform === "win32", // resolve "hermes" from PATH on Windows
      });
      const skills = parseCliSkillList(output);
      if (skills.length) return skills;
    } catch {
      // Older Hermes builds may not expose a CLI list command.
    }
  }
  return [];
}

function discoverGaiaHermesSkills() {
  const discovered = [
    ...discoverViaCli(),
    ...scanSkillDirectory(path.join(GAIA_HERMES_HOME, "skills")),
    ...scanSkillDirectory(process.env.HERMES_SKILLS_DIR),
  ];

  const byName = new Map();
  for (const skill of discovered) {
    if (!skill?.name || byName.has(skill.name)) continue;
    byName.set(skill.name, skill);
  }
  return [...byName.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function readEnabledMap() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function getGaiaHermesSkillSettings() {
  const enabled = readEnabledMap();
  return discoverGaiaHermesSkills().map((skill) => ({
    ...skill,
    enabled: enabled[skill.name] === true,
  }));
}

function setGaiaHermesSkillSettings(next) {
  const installed = new Set(discoverGaiaHermesSkills().map((skill) => skill.name));
  const clean = {};
  for (const [name, enabled] of Object.entries(next || {})) {
    if (installed.has(name)) clean[name] = enabled === true;
  }
  fs.mkdirSync(GAIA_HERMES_HOME, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, `${JSON.stringify(clean, null, 2)}\n`, "utf8");
  return getGaiaHermesSkillSettings();
}

function getEnabledGaiaHermesSkills() {
  return getGaiaHermesSkillSettings().filter((skill) => skill.enabled);
}

module.exports = {
  discoverGaiaHermesSkills,
  getGaiaHermesSkillSettings,
  setGaiaHermesSkillSettings,
  getEnabledGaiaHermesSkills,
};
