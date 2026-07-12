const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { TOKEN } = require("./auth");

const SCRIPT_PATH = path.join(__dirname, "..", "tools", "chatgpt_bulk_import", "bulk_import.py");
const CHRONICLE_PORT = process.env.CHRONICLE_PORT || 4577;

let importProcess = null;
let startedAt = null;
let lastStoppedAt = 0;
// Set synchronously (before the first `await`) at the top of
// startBulkImport, so two near-simultaneous start requests can't both pass
// the "nothing running yet" check during the grace-period wait below —
// importProcess alone isn't set until spawn() actually happens, which is on
// the far side of that wait.
let starting = false;

// Windows' taskkill /f /t returns as soon as the process tree is signalled,
// not necessarily once Chrome has fully released the persistent profile
// directory's lock file — starting a new run immediately after Stop can
// race that. A short grace period after a stop is cheap insurance; genuine
// idle time between runs makes this a no-op.
const RESTART_GRACE_MS = 800;

// Same ring-buffer pattern as gaia-backend/gaiaHermesManager.js — the
// frontend polls this instead of needing a persistent connection.
const MAX_LOG_LINES = 500;
let recentLogLines = [];

function pushLogLine(stream, text) {
  recentLogLines.push({ stream, text, at: new Date().toISOString() });
  if (recentLogLines.length > MAX_LOG_LINES) {
    recentLogLines.splice(0, recentLogLines.length - MAX_LOG_LINES);
  }
}

function getStatus() {
  return {
    running: !!importProcess || starting,
    startedAt,
    lines: recentLogLines,
  };
}

// spawn()'s ENOENT for a missing executable surfaces via the async 'error'
// event, which fires on a later tick than spawn() itself returns — by then
// startBulkImport would already have sent {started: true} back to the
// caller. Checking upfront lets a missing interpreter/script fail
// immediately and honestly instead of reporting fake success first.
function preflightCheck() {
  if (!fs.existsSync(SCRIPT_PATH)) {
    return `bulk_import.py not found at ${SCRIPT_PATH}`;
  }
  if (!TOKEN) {
    return "no Chronicle API token available";
  }
  try {
    execSync("python --version", { stdio: "ignore" });
  } catch {
    return "python not found on PATH — see tools/chatgpt_bulk_import/README.md";
  }
  return null;
}

async function startBulkImport({ limit, headless } = {}) {
  if (importProcess || starting) {
    return { started: false, reason: "already_running" };
  }

  const preflightError = preflightCheck();
  if (preflightError) {
    return { started: false, reason: preflightError };
  }

  starting = true;

  try {
    const sinceStop = Date.now() - lastStoppedAt;
    if (sinceStop < RESTART_GRACE_MS) {
      await new Promise((resolve) => setTimeout(resolve, RESTART_GRACE_MS - sinceStop));
    }

    recentLogLines = [];
    const args = [
      "-u", // unbuffered stdout — otherwise Python batches lines and the
      // frontend's log poll would see nothing until the process exits.
      SCRIPT_PATH,
      "--api-url", `http://127.0.0.1:${CHRONICLE_PORT}`,
      "--token", TOKEN,
    ];
    if (limit) args.push("--limit", String(limit));
    if (headless) args.push("--headless");

    pushLogLine("stdout", `Starting bulk import (limit=${limit || "all"}, headless=${!!headless})...`);
    // Captured in this closure so the event handlers below can check "is
    // this still the current run" by identity — importProcess (the shared,
    // module-level slot) can already point at a *different*, newer run by
    // the time an old process's event fires (e.g. a stale "exit" arriving
    // after Stop was immediately followed by Start). Only the run's own
    // handlers may clear the shared slot, and only if it's still pointing
    // at them.
    const child = spawn("python", args, {
      shell: process.platform === "win32", // resolve "python" from PATH, same as gaiaHermesManager
    });
    importProcess = child;
    startedAt = new Date().toISOString();

    let stdoutBuffer = "";
    child.stdout.on("data", (data) => {
      stdoutBuffer += data.toString();
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      lines.filter(Boolean).forEach((line) => pushLogLine("stdout", line));
    });

    let stderrBuffer = "";
    child.stderr.on("data", (data) => {
      stderrBuffer += data.toString();
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() || "";
      lines.filter(Boolean).forEach((line) => pushLogLine("stderr", line));
    });
    child.on("error", (err) => {
      pushLogLine("stderr", `Failed to start: ${err.message}`);
      if (importProcess === child) importProcess = null;
    });
    child.on("exit", (code, signal) => {
      if (stdoutBuffer) pushLogLine("stdout", stdoutBuffer);
      if (stderrBuffer) pushLogLine("stderr", stderrBuffer);
      pushLogLine("stdout", `Process exited (code=${code}, signal=${signal}).`);
      if (importProcess === child) importProcess = null;
    });

    return { started: true };
  } finally {
    starting = false;
  }
}

function stopBulkImport() {
  if (!importProcess) return { stopped: false, reason: "not_running" };
  const pid = importProcess.pid;
  pushLogLine("stdout", "Stopping bulk import...");
  if (process.platform === "win32") {
    // taskkill on the whole tree — the spawned "python" (via shell:true) and
    // the browser it drives both need to go, same reasoning as
    // gaiaHermesManager.stopGaiaHermes.
    try { execSync(`taskkill /pid ${pid} /f /t`, { stdio: "ignore" }); } catch { /* already gone */ }
  } else {
    try { importProcess.kill("SIGTERM"); } catch { /* already gone */ }
  }
  importProcess = null;
  lastStoppedAt = Date.now();
  return { stopped: true };
}

module.exports = { startBulkImport, stopBulkImport, getStatus };
