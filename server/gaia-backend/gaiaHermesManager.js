const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

// Self-contained Hermes instance for Gaia — lives inside Chronicle's own
// project structure, fully separate from the user's personal ~/.hermes.
// Not a "profile" of the user's personal Hermes install: HERMES_HOME points
// here directly, so this backend ships with Chronicle rather than depending
// on anything already on the host account.
const GAIA_HERMES_HOME = path.join(__dirname, ".hermes-home");
const GAIA_HERMES_PORT = process.env.GAIA_HERMES_PORT || 9120;

// Reads API_SERVER_KEY straight from the instance's own .env — never
// hardcoded or duplicated in frontend settings/localStorage. This is the
// lesson from the old chatEndpoint/chatKey mechanism: stale credentials
// stored client-side caused persistent errors. The frontend always asks
// Chronicle's own backend for the current value instead of caching it.
function getGaiaHermesConfig() {
  const envPath = path.join(GAIA_HERMES_HOME, ".env");
  let key = null;
  try {
    const content = fs.readFileSync(envPath, "utf8");
    const match = content.match(/^API_SERVER_KEY=(.+)$/m);
    key = match ? match[1].trim() : null;
  } catch (err) {
    console.error("[Gaia-Hermes] Could not read API_SERVER_KEY from .env:", err.message);
  }
  return {
    url: `http://127.0.0.1:${GAIA_HERMES_PORT}/v1`,
    key,
  };
}

let gaiaHermesProcess = null;
let stoppingIntentionally = false;

function startGaiaHermes() {
  if (gaiaHermesProcess) {
    console.log("[Gaia-Hermes] Already running, skipping start.");
    return;
  }

  stoppingIntentionally = false;

  console.log(`[Gaia-Hermes] Starting isolated backend on port ${GAIA_HERMES_PORT} (HERMES_HOME=${GAIA_HERMES_HOME})`);

  gaiaHermesProcess = spawn(
    "hermes",
    ["gateway", "run"],
    {
      env: { ...process.env, HERMES_HOME: GAIA_HERMES_HOME },
      shell: true, // required on Windows to resolve "hermes" from PATH
    }
  );

  gaiaHermesProcess.stdout.on("data", (data) => {
    console.log(`[Gaia-Hermes] ${data.toString().trim()}`);
  });

  gaiaHermesProcess.stderr.on("data", (data) => {
    console.error(`[Gaia-Hermes:err] ${data.toString().trim()}`);
  });

  gaiaHermesProcess.on("exit", (code, signal) => {
    console.log(`[Gaia-Hermes] Process exited (code=${code}, signal=${signal})`);
    gaiaHermesProcess = null;

    if (!stoppingIntentionally) {
      console.log("[Gaia-Hermes] Unexpected exit — restarting in 3s...");
      setTimeout(startGaiaHermes, 3000);
    }
  });

  gaiaHermesProcess.on("error", (err) => {
    console.error("[Gaia-Hermes] Failed to start:", err.message);
    gaiaHermesProcess = null;
  });
}

function stopGaiaHermes() {
  if (!gaiaHermesProcess) return;
  stoppingIntentionally = true;
  console.log("[Gaia-Hermes] Stopping backend...");
  // Windows: taskkill on the shell-wrapped process tree; plain kill() often
  // leaves the underlying hermes.exe orphaned when shell:true is used.
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", gaiaHermesProcess.pid, "/f", "/t"]);
  } else {
    gaiaHermesProcess.kill("SIGTERM");
  }
  gaiaHermesProcess = null;
}

module.exports = { startGaiaHermes, stopGaiaHermes, getGaiaHermesConfig, GAIA_HERMES_PORT };
