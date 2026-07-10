// Run-based Gaia turn — used instead of the plain chatWithGaia()/chat/completions
// path whenever gaiaHermesEnabled is on, because /chat/completions has no way
// to resolve an approval Hermes raises mid-turn (see gaiaHermesProxy.js's
// /runs comment). This talks to Chronicle's own proxy at
// /api/settings/gaia-hermes/runs, which forwards to Hermes' /v1/runs API.
//
// Flow: POST /runs -> run_id, then SSE /runs/:id/events for message.delta /
// tool.started / tool.completed / approval.request / run.completed events,
// resolving any approval.request via onApprovalRequest before Hermes'
// tool_executor can continue.
import { getSettings } from "@/lib/settings";

/**
 * @param {object} params
 * @param {string} params.userMessage - the new user message (last turn's text)
 * @param {Array<{role:string, content:string}>} [params.conversationHistory] - prior turns
 * @param {string} [params.sessionId] - stable session id for continuity
 * @param {string} [params.instructions] - ephemeral system prompt for this run
 * @param {(delta: string) => void} [params.onDelta] - streamed text chunks
 * @param {(info: {tool:string, status:string}) => void} [params.onToolProgress]
 * @param {(approval: {command?:string, description?:string, choices:string[]}) => Promise<string>} [params.onApprovalRequest]
 *        Must resolve to one of "once" | "session" | "always" | "deny".
 * @returns {Promise<{output: string, usage: object}>}
 */
export async function runGaiaTurn({
  userMessage,
  conversationHistory = [],
  sessionId = null,
  instructions = null,
  onDelta = () => {},
  onToolProgress = () => {},
  onApprovalRequest = null,
}) {
  const { apiUrl } = getSettings();
  const base = `${apiUrl.replace(/\/+$/, "")}/api/settings/gaia-hermes`;

  const createRes = await fetch(`${base}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: userMessage,
      conversation_history: conversationHistory,
      session_id: sessionId || undefined,
      instructions: instructions || undefined,
    }),
  });
  if (!createRes.ok) {
    const body = await createRes.json().catch(() => ({}));
    throw new Error(body.error?.message || body.error || `Kon geen Gaia-run starten (HTTP ${createRes.status}).`);
  }
  const { run_id: runId } = await createRes.json();
  if (!runId) throw new Error("Geen run_id ontvangen van Gaia's Hermes-backend.");

  return new Promise((resolve, reject) => {
    const source = new EventSource(`${base}/runs/${encodeURIComponent(runId)}/events`);
    let settled = false;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      source.close();
      fn(value);
    };

    source.onmessage = async (msg) => {
      // Keepalive/stream-closed comments arrive as SSE comments (": ..."),
      // which EventSource never surfaces to onmessage — only real "data:"
      // lines land here, so no extra filtering needed.
      let event;
      try {
        event = JSON.parse(msg.data);
      } catch {
        return;
      }

      switch (event.event) {
        case "message.delta":
          onDelta(event.delta || "");
          break;

        case "tool.started":
          onToolProgress({ tool: event.tool, status: "running", label: event.label });
          break;

        case "tool.completed":
          onToolProgress({ tool: event.tool, status: "completed" });
          break;

        case "approval.request": {
          if (!onApprovalRequest) {
            // No handler wired up — deny by default rather than hanging
            // forever, since that's exactly the bug this replaces.
            try {
              await fetch(`${base}/runs/${encodeURIComponent(runId)}/approval`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ choice: "deny" }),
              });
            } catch { /* best-effort */ }
            break;
          }
          try {
            const choice = await onApprovalRequest({
              command: event.command,
              description: event.description,
              choices: event.choices || ["once", "session", "always", "deny"],
            });
            await fetch(`${base}/runs/${encodeURIComponent(runId)}/approval`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ choice: choice || "deny" }),
            });
          } catch (err) {
            console.error("[Gaia run] approval handling failed, denying:", err.message);
            try {
              await fetch(`${base}/runs/${encodeURIComponent(runId)}/approval`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ choice: "deny" }),
              });
            } catch { /* best-effort */ }
          }
          break;
        }

        case "run.completed":
          finish(resolve, { output: event.output || "", usage: event.usage });
          break;

        case "run.failed":
          finish(reject, new Error(event.error || "Gaia's run is mislukt."));
          break;

        case "run.cancelled":
          finish(resolve, { output: "", usage: null, cancelled: true });
          break;

        default:
          break;
      }
    };

    source.onerror = () => {
      // EventSource auto-reconnects on transient errors; only treat it as
      // fatal if the connection is fully closed (readyState 2).
      if (source.readyState === EventSource.CLOSED) {
        finish(reject, new Error("Verbinding met Gaia's run-stream verbroken."));
      }
    };
  });
}
