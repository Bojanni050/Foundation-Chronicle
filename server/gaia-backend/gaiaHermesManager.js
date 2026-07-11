const { spawn, execSync, exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const path = require("path");
const fs = require("fs");

// Self-contained Hermes instance for Gaia — lives inside Chronicle's own
// project structure, fully separate from the user's personal ~/.hermes.
// Not a "profile" of the user's personal Hermes install: HERMES_HOME points
// here directly, so this backend ships with Chronicle rather than depending
// on anything already on the host account.
const GAIA_HERMES_HOME = path.join(__dirname, ".hermes-home");
const GAIA_HERMES_PORT = process.env.GAIA_HERMES_PORT || 9120;

// PID file tracks the last-known gateway process so we can clean it up on
// restart — prevents the "already running" error when the Node server is
// restarted without the gateway having been explicitly stopped first.
const PID_FILE = path.join(GAIA_HERMES_HOME, "gateway.pid");

function writePid(pid) {
  try {
    fs.mkdirSync(GAIA_HERMES_HOME, { recursive: true });
    fs.writeFileSync(PID_FILE, String(pid));
  } catch (err) {
    console.error("[Gaia-Hermes] Could not write PID file:", err.message);
  }
}

function clearPid() {
  try { fs.unlinkSync(PID_FILE); } catch { /* already gone */ }
}

// Kill whatever process actually holds GAIA_HERMES_PORT. The PID we track in
// PID_FILE is unreliable: on Windows we spawn with shell:true (needed to
// resolve "hermes" from PATH), so the tracked PID is cmd.exe's, and the real
// long-lived gateway (a python.exe process launched underneath hermes.exe)
// survives independently once its shell/launcher wrapper exits. Killing the
// tracked PID alone leaves that orphan bound to the port, which then makes
// every subsequent "hermes gateway run --replace" fail with an "already
// running" conflict forever — an infinite 3s restart loop. Killing by port
// is the only thing that reliably frees it.
function killProcessOnPort(port) {
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano -p TCP`, { encoding: "utf8" });
      const pids = new Set();
      for (const line of out.split("\n")) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const [, localAddr, , state, pid] = parts;
        if (state !== "LISTENING") continue;
        if (!localAddr.endsWith(`:${port}`)) continue;
        if (pid && !isNaN(parseInt(pid, 10))) pids.add(pid);
      }
      for (const pid of pids) {
        console.log(`[Gaia-Hermes] Killing orphaned process on port ${port} (PID ${pid})...`);
        try { execSync(`taskkill /pid ${pid} /f /t`, { stdio: "ignore" }); } catch { /* already gone */ }
      }
    } else {
      const out = execSync(`lsof -ti tcp:${port}`, { encoding: "utf8" }).trim();
      for (const pid of out.split("\n").filter(Boolean)) {
        console.log(`[Gaia-Hermes] Killing orphaned process on port ${port} (PID ${pid})...`);
        try { process.kill(parseInt(pid, 10), "SIGKILL"); } catch { /* already gone */ }
      }
    }
  } catch {
    // No process found on the port (netstat/lsof exit non-zero) — nothing to clean up.
  }
}

// Kill any stale Hermes gateway that is still occupying the port, whether or
// not it's the process we happened to track in PID_FILE.
function killStalePid() {
  let pid = null;
  try {
    pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
  } catch { /* no PID file — fine, still check the port below */ }

  if (pid && !isNaN(pid)) {
    console.log(`[Gaia-Hermes] Killing tracked gateway process (PID ${pid})...`);
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /pid ${pid} /f /t`, { stdio: "ignore" });
      } else {
        process.kill(pid, "SIGTERM");
      }
    } catch {
      // Process already gone — that's fine.
    }
  }
  clearPid();

  killProcessOnPort(GAIA_HERMES_PORT);

  // Give the OS a moment to release the port before we spawn the new one.
  return new Promise((resolve) => setTimeout(resolve, 600));
}

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

// Recent stdout/stderr lines from Hermes, so the chat UI can show what Gaia
// is actually doing (tool calls, tool results, warnings) alongside her
// answer — not just the final text. Capped ring buffer, in-memory only.
const MAX_LOG_LINES = 200;
let recentLogLines = [];

function pushLogLine(stream, text) {
  const line = { stream, text, at: new Date().toISOString() };
  recentLogLines.push(line);
  if (recentLogLines.length > MAX_LOG_LINES) {
    recentLogLines.splice(0, recentLogLines.length - MAX_LOG_LINES);
  }
}

function getRecentLogLines(sinceIso) {
  if (!sinceIso) return recentLogLines;
  return recentLogLines.filter((l) => l.at > sinceIso);
}

// Noise from Hermes' own per-turn tool-availability probing — it checks
// every possible tool's prerequisites (browser, vision, web search, Nous
// auxiliary) regardless of which toolsets are actually enabled for this
// profile (only terminal+file are). Nothing actionable for Gaia's use case,
// so it never enters the ring buffer at all.
const NOISY_LINE_PATTERNS = [
  /check_fn .* returned False/,
  /Auxiliary Nous client unavailable/,
  /Auxiliary: marking nous unhealthy/,
];

function isNoisyLine(text) {
  return NOISY_LINE_PATTERNS.some((re) => re.test(text));
}

// Registers Chronicle's specialists-MCP endpoint with this Hermes instance
// so Gaia can reach confirmed specialists as tools regardless of which
// transport (/chat/completions or /v1/runs) a given turn uses. Idempotent:
// `hermes mcp add` on an already-registered name errors, which is caught and
// ignored — safe to call on every startup, not just the first.
//
// Must be called AFTER Chronicle's own app.listen() is up: `hermes mcp add`
// immediately tries to connect to the URL to discover tools, so calling this
// before Chronicle is listening guarantees a ~40s connection-timeout on
// every single startup. Async (not execSync) for the same reason — this
// must never block the rest of startup while it waits on that connection
// attempt or on the interactive auth prompt below.
async function registerSpecialistsMcp() {
  const chroniclePort = process.env.CHRONICLE_PORT || 4577;
  try {
    const child = execAsync(
      `hermes mcp add gaia-specialists --url http://127.0.0.1:${chroniclePort}/mcp/specialists`,
      { env: { ...process.env, HERMES_HOME: GAIA_HERMES_HOME }, shell: true }
    );
    // `hermes mcp add` interactively asks "Does this server require
    // authentication? [Y/n]" before it even attempts to connect. With no TTY
    // attached that prompt would hang forever waiting for stdin, so answer
    // it directly on the child's stdin — util.promisify(exec) exposes the
    // underlying ChildProcess as `.child` on the returned promise.
    child.child.stdin.write("n\n");
    child.child.stdin.end();
    await child;
    console.log("[Gaia-Hermes] Registered gaia-specialists MCP server.");
  } catch (err) {
    const out = (err.stdout || "") + (err.stderr || "");
    if (/already exists|already configured/i.test(out)) {
      // Fine — already registered from a previous run.
    } else {
      console.error("[Gaia-Hermes] Could not register specialists MCP server:", out.trim() || err.message);
    }
  }
  // MCP-registered toolsets are off by default until explicitly enabled —
  // same opt-in-by-default pattern as the Discord toolset. Best-effort:
  // already-enabled is not an error worth surfacing.
  try {
    await execAsync(
      `hermes tools enable gaia-specialists`,
      { env: { ...process.env, HERMES_HOME: GAIA_HERMES_HOME }, shell: true }
    );
  } catch (err) {
    const out = (err.stdout || "") + (err.stderr || "");
    console.error("[Gaia-Hermes] Could not enable gaia-specialists toolset:", out.trim() || err.message);
  }
}

async function startGaiaHermes() {
  if (gaiaHermesProcess) {
    console.log("[Gaia-Hermes] Already running in this process, skipping start.");
    return;
  }

  // Kill any orphaned gateway from a previous server run before starting.
  await killStalePid();

  stoppingIntentionally = false;

  console.log(`[Gaia-Hermes] Starting isolated backend on port ${GAIA_HERMES_PORT} (HERMES_HOME=${GAIA_HERMES_HOME})`);

  gaiaHermesProcess = spawn(
    "hermes",
    ["gateway", "run", "--replace"],
    {
      env: { ...process.env, HERMES_HOME: GAIA_HERMES_HOME },
      shell: process.platform === "win32", // required on Windows to resolve "hermes" from PATH
    }
  );

  writePid(gaiaHermesProcess.pid);

  gaiaHermesProcess.stdout.on("data", (data) => {
    const text = data.toString().trim();
    console.log(`[Gaia-Hermes] ${text}`);
    pushLogLine("stdout", text);
  });
  gaiaHermesProcess.stdout.on("error", (err) => {
    // Defensive: an EPIPE/write-after-close on the piped stream itself would
    // otherwise be an uncaught exception on this stream, which crashes the
    // whole Node process — not just this child. A Hermes crash must never
    // take Chronicle's own server down with it.
    console.error("[Gaia-Hermes] stdout stream error (ignored):", err.message);
  });

  gaiaHermesProcess.stderr.on("data", (data) => {
    const msg = data.toString().trim();
    if (isNoisyLine(msg)) return; // skip entirely — not in buffer, not in console
    pushLogLine("stderr", msg);
    // Suppress the duplicate-instance warning — it's expected transiently
    // while the previous process is finishing its shutdown.
    if (!msg.includes("already running")) {
      console.error(`[Gaia-Hermes:err] ${msg}`);
    }
  });
  gaiaHermesProcess.stderr.on("error", (err) => {
    console.error("[Gaia-Hermes] stderr stream error (ignored):", err.message);
  });

  gaiaHermesProcess.on("exit", (code, signal) => {
    console.log(`[Gaia-Hermes] Process exited (code=${code}, signal=${signal})`);
    gaiaHermesProcess = null;
    clearPid();

    if (!stoppingIntentionally) {
      console.log("[Gaia-Hermes] Unexpected exit — restarting in 3s...");
      setTimeout(startGaiaHermes, 3000);
    }
  });

  gaiaHermesProcess.on("error", (err) => {
    console.error("[Gaia-Hermes] Failed to start:", err.message);
    gaiaHermesProcess = null;
    clearPid();
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
  clearPid();
}

module.exports = { startGaiaHermes, stopGaiaHermes, getGaiaHermesConfig, getRecentLogLines, pushLogLine, registerSpecialistsMcp, GAIA_HERMES_PORT };
