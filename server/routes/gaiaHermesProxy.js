// Proxies chat-completion calls to Gaia's self-contained Hermes backend.
// A direct browser fetch to 127.0.0.1:9120 is blocked: Hermes' gateway
// returns 403 on the CORS preflight (OPTIONS), so the browser never even
// sends the real POST. Routing through Chronicle's own already-permitted
// origin sidesteps that entirely, and as a bonus the API key never has to
// reach the browser at all — same server-side-proxy pattern used elsewhere
// in routes/settings.js.
const express = require("express");
const { Readable } = require("stream");
const { getGaiaHermesConfig, getRecentLogLines, pushLogLine } = require("../gaia-backend/gaiaHermesManager");
const {
  getGaiaHermesSkillSettings,
  setGaiaHermesSkillSettings,
  getEnabledGaiaHermesSkills,
} = require("../gaia-backend/gaiaHermesSkills");

const router = express.Router();

// GET /api/settings/gaia-hermes/activity?since=<ISO timestamp> — recent
// stdout/stderr lines from Gaia's Hermes backend, so the chat UI can show
// what she's actually doing (tool calls, tool results) alongside her reply.
router.get("/activity", (req, res) => {
  res.json({ lines: getRecentLogLines(req.query.since) });
});

// GET/PATCH /api/settings/gaia-hermes/skills — which of Gaia's discovered
// Hermes skills are enabled. New skills default to disabled (see
// gaiaHermesSkills.js) so a Hermes update never silently hands Gaia a new
// capability.
router.get("/skills", (_req, res) => {
  res.json({ skills: getGaiaHermesSkillSettings() });
});

router.patch("/skills", (req, res) => {
  try {
    const skills = setGaiaHermesSkillSettings(req.body?.enabled || {});
    res.json({ skills });
  } catch (err) {
    res.status(400).json({ error: err.message || "Could not save Gaia Hermes skills." });
  }
});

// Prompt-level skill gate: until Hermes itself can filter skills_list/
// skill_view server-side by allowlist, this is enforced by telling Gaia
// which skill names exist and forbidding her from probing for others. Not
// as strong as a real server-side filter (a model can still ignore an
// instruction), but it's what's available without modifying Hermes' own
// skills_list/skill_view tool implementations, which live outside this repo.
function buildSkillPolicyText() {
  const enabledSkills = getEnabledGaiaHermesSkills();
  return enabledSkills.length
    ? [
        "CHRONICLE SKILL POLICY:",
        `Only these Hermes skills are enabled for this agent: ${enabledSkills.map((skill) => skill.name).join(", ")}.`,
        "Never call skill_view for any other name. Do not call skills_list to discover additional skills.",
        "If an enabled skill cannot be loaded, treat that as recoverable and continue the chat without repeating the same tool call.",
      ].join("\n")
    : [
        "CHRONICLE SKILL POLICY:",
        "No Hermes skills are enabled for this agent.",
        "Do not call skills_list or skill_view. Continue normally without skills.",
      ].join("\n");
}

// After a session-scoped chat call, fetch that session's stored messages and
// push the latest assistant reasoning_content into the same activity ring
// buffer the frontend already polls — no separate frontend contract needed.
// Best-effort: reasoning may be empty (model didn't reason this turn) or the
// session lookup may fail; neither should affect the chat response itself.
async function fetchAndRecordReasoning(baseUrl, key, sessionId) {
  try {
    const r = await fetch(`${baseUrl.replace(/\/v1$/, "")}/api/sessions/${sessionId}/messages`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) return;
    const messages = await r.json();
    const list = Array.isArray(messages) ? messages : messages?.messages || [];
    const lastAssistant = [...list].reverse().find((m) => m.role === "assistant" && m.reasoning_content);
    if (lastAssistant?.reasoning_content) {
      pushLogLine("reasoning", lastAssistant.reasoning_content);
    }
  } catch (err) {
    console.error("[Gaia-Hermes] Could not fetch reasoning for session", sessionId, ":", err.message);
  }
}

router.post("/chat/completions", async (req, res) => {
  const { url, key } = getGaiaHermesConfig();
  if (!key) {
    return res.status(503).json({ error: "Gaia's Hermes-backend heeft nog geen geldige API-key (nog niet opgestart?)." });
  }
  const sessionId = req.headers["x-hermes-session-id"];

  const skillPolicy = buildSkillPolicyText();
  const messages = Array.isArray(req.body?.messages) ? [...req.body.messages] : [];
  const systemIndex = messages.findIndex((m) => m?.role === "system");
  if (systemIndex >= 0) {
    messages[systemIndex] = { ...messages[systemIndex], content: `${messages[systemIndex].content || ""}\n\n${skillPolicy}` };
  } else {
    messages.unshift({ role: "system", content: skillPolicy });
  }
  const body = { ...req.body, messages };

  try {
    const r = await fetch(`${url}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(sessionId ? { "X-Hermes-Session-Id": sessionId } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
    if (sessionId && r.ok) {
      console.log(`[Gaia-Hermes] Fetching reasoning for session ${sessionId}...`);
      fetchAndRecordReasoning(url, key, sessionId).then(() =>
        console.log(`[Gaia-Hermes] Reasoning fetch for ${sessionId} done.`)
      );
    } else {
      console.log(`[Gaia-Hermes] Skipped reasoning fetch (sessionId=${sessionId}, ok=${r.ok})`);
    }
  } catch (err) {
    res.status(503).json({ error: "Gaia's Hermes-backend is niet bereikbaar.", detail: err.message });
  }
});

// --- Run-based API (used instead of /chat/completions whenever the caller
// wants approval-gated tool calls to be resolvable). Plain /chat/completions
// has no run_id and no approval endpoint tied to it: if Gaia's turn triggers
// a dangerous-command approval there, the request just hangs forever with no
// way to answer it (see tools/approval.py's gateway-approval-context note).
// The /v1/runs/* API gives every turn a run_id, an SSE event stream (which
// carries "approval.request" events), and a POST .../approval endpoint to
// resolve them — so Chronicle can actually show the prompt and answer it.

// POST /api/settings/gaia-hermes/runs — start a run, get a run_id back
// immediately. Body is passed through verbatim (input, session_id,
// conversation_history, instructions, previous_response_id — see Hermes'
// own /v1/runs schema).
router.post("/runs", async (req, res) => {
  const { url, key } = getGaiaHermesConfig();
  if (!key) {
    return res.status(503).json({ error: "Gaia's Hermes-backend heeft nog geen geldige API-key (nog niet opgestart?)." });
  }
  const skillPolicy = buildSkillPolicyText();
  const body = {
    ...req.body,
    instructions: req.body?.instructions ? `${req.body.instructions}\n\n${skillPolicy}` : skillPolicy,
  };

  try {
    const r = await fetch(`${url}/runs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    res.status(503).json({ error: "Gaia's Hermes-backend is niet bereikbaar.", detail: err.message });
  }
});

// GET /api/settings/gaia-hermes/runs/:runId/events — SSE passthrough. The
// browser can't hit 127.0.0.1:9120 directly (same CORS wall as
// /chat/completions), so this pipes Hermes' own SSE stream through
// Chronicle's already-permitted origin byte-for-byte.
router.get("/runs/:runId/events", async (req, res) => {
  const { url, key } = getGaiaHermesConfig();
  if (!key) {
    return res.status(503).json({ error: "Gaia's Hermes-backend heeft nog geen geldige API-key (nog niet opgestart?)." });
  }
  let upstream;
  try {
    upstream = await fetch(`${url}/runs/${encodeURIComponent(req.params.runId)}/events`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "text/event-stream" },
    });
  } catch (err) {
    return res.status(503).json({ error: "Gaia's Hermes-backend is niet bereikbaar.", detail: err.message });
  }
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return res.status(upstream.status || 502).json({ error: "Kon geen SSE-stream openen bij Hermes.", detail: text.slice(0, 300) });
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const nodeStream = Readable.fromWeb(upstream.body);
  nodeStream.pipe(res);
  // If the browser tab/EventSource closes, stop pulling from Hermes too —
  // otherwise the upstream connection (and the run's event queue) leaks.
  req.on("close", () => {
    nodeStream.destroy();
  });
});

// POST /api/settings/gaia-hermes/runs/:runId/approval — resolve a pending
// approval. Body: { choice: "once" | "session" | "always" | "deny", resolve_all?: bool }.
router.post("/runs/:runId/approval", async (req, res) => {
  const { url, key } = getGaiaHermesConfig();
  if (!key) {
    return res.status(503).json({ error: "Gaia's Hermes-backend heeft nog geen geldige API-key (nog niet opgestart?)." });
  }
  try {
    const r = await fetch(`${url}/runs/${encodeURIComponent(req.params.runId)}/approval`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    res.status(503).json({ error: "Gaia's Hermes-backend is niet bereikbaar.", detail: err.message });
  }
});

module.exports = router;
