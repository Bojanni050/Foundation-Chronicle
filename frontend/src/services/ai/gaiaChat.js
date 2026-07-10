// Gaia's own chat flow: builds the system prompt from confirmed persona
// traits, offers confirmed specialists as tools, and runs each requested
// specialist as its own isolated LLM call so its richer system prompt/
// evidence never enters Gaia's own context.
import { getSettings } from "@/lib/settings";
import { slugify } from "@/lib/typeRegistry";
import { chat, chatMessage } from "./core";

export async function chatWithHermes(messages) {
  return chatWithGaia(messages);
}

// When enabled, Gaia's own turn (not specialist calls — those stay on their
// own configured model) routes through her self-contained Hermes backend
// instead of OpenRouter directly. URL/key are fetched fresh from Chronicle's
// backend every call, never cached in settings/localStorage — see the
// comment on gaiaHermesEnabled in lib/settings.js for why. On any failure
// this throws rather than silently falling back to direct OpenRouter, so a
// misconfigured or stopped Hermes backend surfaces clearly instead of
// masking itself as ordinary chat behavior.
async function resolveGaiaEndpoint(apiUrl) {
  let res;
  try {
    res = await fetch(`${apiUrl}/api/settings/gaia-hermes-config`);
  } catch (err) {
    throw new Error(`Gaia's Hermes-backend is niet bereikbaar via Chronicle (${err.message}).`);
  }
  if (!res.ok) {
    throw new Error(`Chronicle kon Gaia's Hermes-configuratie niet ophalen (HTTP ${res.status}).`);
  }
  const { url, key } = await res.json();
  if (!url || !key) {
    throw new Error("Gaia's Hermes-backend heeft nog geen geldige API-key (nog niet opgestart?).");
  }
  return { customEndpoint: url, customKey: key };
}

export async function chatWithGaia(messages) {
  const { models, apiUrl, gaiaHermesEnabled } = getSettings();
  let gaiaEndpoint = {};
  if (gaiaHermesEnabled) {
    gaiaEndpoint = await resolveGaiaEndpoint(apiUrl);
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
    "IMPORTANT: At the very end of your response, always propose exactly 2 or 3 short, contextually relevant follow-up questions for the user to explore next. " +
    "Format them exactly like this: [Doorvragen: Vraag 1 | Vraag 2 | Vraag 3]. " +
    "Example: '[Doorvragen: Kun je een codevoorbeeld geven? | Waarom is dit lokaal-first? | Wat zijn de alternatieven?]'. " +
    "Do not put any other text after this brackets block.";

  const formattedMessages = [{ role: "system", content: systemPrompt }, ...messages];

  const firstMessage = await chatMessage(
    formattedMessages,
    tools.length ? { tools, tool_choice: "auto", temperature: 0.7 } : { temperature: 0.7 },
    models.chat,
    "chat",
    gaiaEndpoint.customEndpoint,
    gaiaEndpoint.customKey
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
    "chat",
    gaiaEndpoint.customEndpoint,
    gaiaEndpoint.customKey
  );
}
