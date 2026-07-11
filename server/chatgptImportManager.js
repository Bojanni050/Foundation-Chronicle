const { spawn, execSync } = require("child_process");
const path = require("path");
const { TOKEN } = require("./auth");

const SCRIPT_PATH = path.join(__dirname, "..", "tools", "chatgpt_bulk_import", "bulk_import.py");
const CHRONICLE_PORT = process.env.CHRONICLE_PORT || 4577;

let importProcess = null;
let startedAt = null;

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
    running: !!importProcess,
    startedAt,
    lines: recentLogLines,
  };
}

function startBulkImport({ limit, headless } = {}) {
  if (importProcess) {
    return { started: false, reason: "already_running" };
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
  importProcess = spawn("python", args, {
    shell: process.platform === "win32", // resolve "python" from PATH, same as gaiaHermesManager
  });
  startedAt = new Date().toISOString();

  importProcess.stdout.on("data", (data) => {
    data.toString().split(/\r?\n/).filter(Boolean).forEach((line) => pushLogLine("stdout", line));
  });
  importProcess.stderr.on("data", (data) => {
    data.toString().split(/\r?\n/).filter(Boolean).forEach((line) => pushLogLine("stderr", line));
  });
  importProcess.on("error", (err) => {
    pushLogLine("stderr", `Failed to start: ${err.message}`);
    importProcess = null;
  });
  importProcess.on("exit", (code, signal) => {
    pushLogLine("stdout", `Process exited (code=${code}, signal=${signal}).`);
    importProcess = null;
  });

  return { started: true };
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
  return { stopped: true };
}

module.exports = { startBulkImport, stopBulkImport, getStatus };
