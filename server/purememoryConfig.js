const fs = require("fs");
const path = require("path");

// Whether Chronicle should auto-start the PureMemory collector-agent
// alongside itself. Defaults to true ("starts with Chronicle unless turned
// off") — persisted as a file, same pattern as embedding.js's model choice,
// because the Node server (not just the browser) needs to read this at
// startup, before any frontend Settings dialog has even been opened.
const DATA_DIR = path.join(__dirname, "data");
const CONFIG_FILE = path.join(DATA_DIR, "purememory-config.json");

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return { enabled: true };
  }
}

function writeConfig(cfg) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function isEnabled() {
  return readConfig().enabled !== false;
}

function setEnabled(enabled) {
  writeConfig({ enabled: !!enabled });
}

module.exports = { isEnabled, setEnabled };
