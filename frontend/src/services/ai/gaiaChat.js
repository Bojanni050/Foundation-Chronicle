// Gaia's own chat flow: builds the system prompt from confirmed persona
// traits, offers confirmed specialists as tools, and runs each requested
// specialist as its own isolated LLM call so its richer system prompt/
// evidence never enters Gaia's own context.
import { getSettings } from "@/lib/settings";
import { slugify } from "@/lib/typeRegistry";
import { chat, chatMessage } from "./core";
import { runGaiaTurn } from "./runGaia";

export async function chatWithHermes(messages) {
  return chatWithGaia(messages);
}

// When enabled, Gaia's chat turn is routed through Chronicle's own backend
// proxy endpoint (/api/settings/gaia-hermes-chat), which then forwards the
// request to the self-contained Hermes gateway (127.0.0.1:9120). This is
// necessary because the browser cannot call 127.0.0.1:9120 directly — Hermes
// issues a 403 on CORS OPTIONS preflight requests. The Chronicle backend has
// no CORS issue and keeps the API key server-side (never in localStorage).
async function resolveGaiaEndpoint(apiUrl) {
  // Verify the backend actually has a valid Hermes config before we route there
  let res;
  try {
    res = await fetch(`${apiUrl}/api/settings/gaia-hermes-config`);
  } catch (err) {
    throw new Error(`Gaia's Hermes-backend is niet bereikbaar via Chronicle (${err.message}).`);
  }
  if (!res.ok) {
    throw new Error(`Chronicle kon Gaia's Hermes-configuratie niet ophalen (HTTP ${res.status}).`);
  }
  const { key } = await res.json();
  if (!key) {
    throw new Error("Gaia's Hermes-backend heeft nog geen geldige API-key (nog niet opgestart?).");
  }
  // Return Chronicle's own proxy URL stripped of the trailing /chat/completions
  // suffix — core.js will append that itself. The sentinel key "proxy" satisfies
  // core.js's non-empty check; the real auth is handled server-side.
  return {
    customEndpoint: `${apiUrl}/api/settings/gaia-hermes`,
    customKey: "proxy",
  };
}

export async function chatWithGaia(messages, sessionId = null, hermesCallbacks = {}) {
  const { models, apiUrl, gaiaHermesEnabled } = getSettings();

  // Hermes-routed turns go through the approval-capable run-based API
  // (runGaia.js) instead of the plain chat/completions path used below.
  // /v1/runs has no `tools` parameter, so specialists are offered to Gaia
  // via the gaia-specialists MCP server (see specialistsMcpServer.js)
  // instead of the manual tools array built further down — Hermes resolves
  // those tool calls itself, Chronicle never sees them.
  if (gaiaHermesEnabled) {
    await resolveGaiaEndpoint(apiUrl); // throws early if Hermes isn't reachable/configured
    const history = messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
    const userMessage = messages[messages.length - 1]?.content || "";
    const { output } = await runGaiaTurn({
      userMessage,
      conversationHistory: history,
      sessionId,
      instructions:
        "You are Gaia, Chronicle's helpful, context-aware AI assistant — a local-first personal knowledge app. " +
        "Maintain a supportive, clear, and highly professional tone. " +
        "IMPORTANT: When using search_files or any tool expecting a regular expression, do NOT use glob patterns like `*.js`. Always use valid regex like `.*\\.js` to avoid parse errors. " +
        "At the very end of your response, always propose exactly 2 or 3 short, contextually relevant follow-up " +
        "questions, formatted exactly like this: [Doorvragen: Vraag 1 | Vraag 2 | Vraag 3]. Do not put any other " +
        "text after this brackets block.",
      onDelta: hermesCallbacks.onDelta,
      onToolProgress: hermesCallbacks.onToolProgress,
      onApprovalRequest: hermesCallbacks.onApprovalRequest,
    });
    return output;
  }

  let traitsText = "";
  try {
    if (apiUrl) {
      const res = await fetch(`${apiUrl}/api/persona/kenmerken`);
      if (res.ok) {
        const traits = await res.json();
        traitsText = traits.map(t => `- ${t.kenmerk}`).join("\n");
      }
    }
  } catch (err) {
    console.warn("Could not fetch persona traits for chat prompt context:", err.message);
  }

  // Confirmed specialists are offered to Gaia as tools rather than folded
  // into this system prompt — keeps Gaia's own context lean, and only pays
  // the cost of a specialist's deeper context when a question actually
  // needs it.
  const { getConfirmedSpecialisten } = await import("../specialistSync");
  const specialisten = await getConfirmedSpecialisten().catch(() => []);
  const toolName = (s) => `ask_${slugify(s.onderwerp)}_specialist`;
  const tools = specialisten.map((s) => ({
    type: "function",
    function: {
      name: toolName(s),
      description: `Ask a specialist focused on "${s.onderwerp}" a specific question. Use this instead of guessing when the question is specifically about ${s.onderwerp}.`,
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The focused question to hand to the specialist." },
        },
        required: ["question"],
      },
    },
  }));

  const systemPrompt =
    "You are Gaia, Chronicle's helpful, context-aware AI assistant — a local-first personal knowledge app.\n" +
    "You have access to the user's confirmed memory traits below. Use them as a background lens to understand the user's context, habits, preferences, and style, but do not restate them unless directly relevant to the conversation.\n\n" +
    (traitsText ? `USER'S PERSONAL TRAITS:\n${traitsText}\n\n` : "") +
    (specialisten.length
      ? `You have specialist sub-agents available as tools for topics the owner works with a lot: ${specialisten
          .map((s) => s.onderwerp)
          .join(", ")}. Delegate to them for focused, topic-specific questions rather than answering from general knowledge.\n\n`
      : "") +
    "Maintain a supportive, clear, and highly professional tone.\n\n" +
    "IMPORTANT: When using search_files or any tool expecting a regular expression, do NOT use glob patterns like `*.js`. Always use valid regex like `.*\\.js` to avoid parse errors.\n\n" +
    "IMPORTANT: At the very end of your response, always propose exactly 2 or 3 short, contextually relevant follow-up questions for the user to explore next. " +
    "Format them exactly like this: [Doorvragen: Vraag 1 | Vraag 2 | Vraag 3]. " +
    "Example: '[Doorvragen: Kun je een codevoorbeeld geven? | Waarom is dit lokaal-first? | Wat zijn de alternatieven?]'. " +
    "Do not put any other text after this brackets block.";

  const formattedMessages = [{ role: "system", content: systemPrompt }, ...messages];

  const firstMessage = await chatMessage(
    formattedMessages,
    tools.length ? { tools, tool_choice: "auto", temperature: 0.7 } : { temperature: 0.7 },
    models.chat,
    "chat"
  );

  if (!firstMessage.tool_calls || !firstMessage.tool_calls.length) {
    return firstMessage.content || "";
  }

  // Run each requested specialist as its own, isolated LLM call — the
  // specialist's own (richer) system prompt and evidence never enter
  // Gaia's context, only its short answer does.
  const toolResultMessages = [];
  for (const call of firstMessage.tool_calls) {
    const specialist = specialisten.find((s) => call.function?.name === toolName(s));
    let answer = "That specialist is no longer available.";
    if (specialist) {
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        /* malformed tool args — fall back to empty question */
      }
      try {
        answer = await chat(
          [
            {
              role: "system",
              content: specialist.system_prompt || `You are a specialist in ${specialist.onderwerp}.`,
            },
            { role: "user", content: args.question || "" },
          ],
          { temperature: 0.4 },
          specialist.model || models.specialist,
          "specialist"
        );
      } catch (err) {
        answer = `The specialist call failed: ${err.message}`;
      }
    }
    toolResultMessages.push({ role: "tool", tool_call_id: call.id, content: answer });
  }

  const followUpMessages = [
    ...formattedMessages,
    { role: "assistant", content: firstMessage.content || null, tool_calls: firstMessage.tool_calls },
    ...toolResultMessages,
  ];

  return await chat(
    followUpMessages,
    { temperature: 0.7 },
    models.chat,
    "chat"
  );
}
// Direct specialist conversation — used when the user opens a specialist tab
// in ChatDialog and chats with it directly, bypassing Gaia's routing layer.
// The specialist's own system prompt is used; the model falls back to the
// settings specialist model if none is set on the specialist row itself.
export async function chatWithSpecialist(specialistName, messages) {
  const { models } = getSettings();
  const { getConfirmedSpecialisten } = await import("../specialistSync");
  const specialisten = await getConfirmedSpecialisten().catch(() => []);
  const specialist = specialisten.find(
    (s) => s.onderwerp.toLowerCase() === specialistName.toLowerCase()
  );
  if (!specialist) {
    throw new Error(`Specialist "${specialistName}" not found or no longer confirmed.`);
  }
  const systemMessage = {
    role: "system",
    content: specialist.system_prompt || `You are a specialist in ${specialist.onderwerp}.`,
  };
  return await chat(
    [systemMessage, ...messages],
    { temperature: 0.4 },
    specialist.model || models.specialist,
    "specialist"
  );
}
