const path = require("path");
const { spawn } = require("child_process");
const { TOKEN } = require("./auth");
const { isEnabled } = require("./activityAgentConfig");

// Native Rust replacement for the old PureMemory Go collector-agent
// (purememoryIngest.js, removed). Same "sidecar managed by Node" shape —
// Chronicle owns the child process outright this time (our own binary, not
// a third-party exe with an unpredictable process list), so there's no
// tasklist/taskkill dance: just spawn it, and kill it when Chronicle exits.
//
// activity-agent/ (top-level crate, sibling to src-tauri/) polls the
// Windows foreground window via UI Automation, buffers text per focus
// session, and POSTs each completed session straight to
// POST /api/activity/import — no SQLite hop, no external dependency.
const AGENT_EXE_PATH =
  process.env.CHRONICLE_ACTIVITY_AGENT_PATH ||
  path.join(__dirname, "..", "activity-agent", "target", "release", "activity-agent.exe");

const PORT = process.env.CHRONICLE_PORT || 4577;

let managedChild = null;

function startActivityAgent() {
  if (!isEnabled()) {
    console.log("[ActivityAgent] Disabled in Settings — skipping.");
    return;
  }
  if (managedChild && !managedChild.killed) return; // already started by us

  try {
    managedChild = spawn(AGENT_EXE_PATH, [], {
      stdio: "ignore",
      windowsHide: true,
      env: {
        ...process.env,
        CHRONICLE_API_URL: `http://127.0.0.1:${PORT}`,
        CHRONICLE_TOKEN: TOKEN,
      },
    });
    managedChild.on("error", (err) => {
      // Expected/harmless off-Windows or before the crate has been built —
      // same best-effort, never-block-startup posture as the rest of
      // Chronicle's local-agent-optional features.
      console.error("[ActivityAgent] Failed to start:", err.message);
      managedChild = null;
    });
    managedChild.on("exit", () => {
      managedChild = null;
    });
    console.log("[ActivityAgent] Started alongside Chronicle.");
  } catch (err) {
    console.error("[ActivityAgent] Could not spawn:", err.message);
  }
}

function stopActivityAgent() {
  if (managedChild && !managedChild.killed) managedChild.kill();
}

process.on("exit", stopActivityAgent);

module.exports = { startActivityAgent, stopActivityAgent };
