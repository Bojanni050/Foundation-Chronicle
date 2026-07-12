// Exposes Chronicle's confirmed specialists as MCP tools, so Gaia can call
// them from *any* Hermes transport — including the run-based /v1/runs API,
// which (unlike /chat/completions) has no `tools` parameter of its own. This
// replaces the old approach of passing specialist tool defs directly in the
// chat/completions request body: that only worked for the plain chat path,
// and would have silently broken specialists the moment Gaia's turns moved
// to the approval-capable run-based flow (see runGaia.js).
//
// Tool list is generated fresh on every ListTools call (no caching) so a
// newly confirmed specialist becomes callable without restarting anything.
//
// Specialist answers are generated via Gaia's own already-authenticated
// Hermes backend (getGaiaHermesConfig()) rather than the user's personal
// OpenRouter key, which only ever lives in the browser and was never meant
// to be duplicated server-side.
const express = require("express");
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const crypto = require("crypto");
const { z } = require("zod");
const { pool } = require("../db");
const { getGaiaHermesConfig } = require("./gaiaHermesManager");

const router = express.Router();

// Same slugify rule the frontend uses for tool names (services/ai/gaiaChat.js
// via lib/typeRegistry's slugify) — kept in sync manually since this is the
// only other place a specialist's onderwerp becomes a tool name.
function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function getConfirmedSpecialists() {
  const { rows } = await pool.query(
    "SELECT id, onderwerp, system_prompt, model FROM specialist WHERE status = 'confirmed' ORDER BY onderwerp"
  );
  return rows;
}

async function askSpecialist(specialist, question) {
  const { url, key } = getGaiaHermesConfig();
  if (!key) throw new Error("Gaia's Hermes-backend heeft nog geen geldige API-key.");
  const messages = [
    { role: "system", content: specialist.system_prompt || `You are a specialist in ${specialist.onderwerp}.` },
    { role: "user", content: question || "" },
  ];
  const r = await fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: specialist.model || undefined, messages, temperature: 0.4 }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Specialist-aanroep mislukt (HTTP ${r.status}): ${t.slice(0, 200)}`);
  }
  const data = await r.json();
  return data.choices?.[0]?.message?.content || "(geen antwoord)";
}

// Global stateful transport and server. We handle dynamic tools by intercepting
// ListToolsRequestSchema instead of rebuilding the transport per-request.
const server = new Server({ name: "chronicle-specialists", version: "1.0.0" }, { capabilities: { tools: {} } });
const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const specialists = await getConfirmedSpecialists();
  return {
    tools: specialists.map(s => ({
      name: `ask_${slugify(s.onderwerp)}_specialist`,
      description: `Ask a specialist focused on "${s.onderwerp}" a specific question. Use this instead of guessing when the question is specifically about ${s.onderwerp}.`,
      inputSchema: { type: "object", properties: { question: { type: "string", description: "The focused question to hand to the specialist." } }, required: ["question"] }
    }))
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const specialists = await getConfirmedSpecialists();
  const s = specialists.find(s => `ask_${slugify(s.onderwerp)}_specialist` === name);
  if (!s) return { content: [{ type: "text", text: `Unknown specialist: ${name}` }], isError: true };
  
  try {
    const answer = await askSpecialist(s, args?.question);
    return { content: [{ type: "text", text: answer }] };
  } catch (err) {
    return { content: [{ type: "text", text: `De specialist-aanroep faalde: ${err.message}` }], isError: true };
  }
});

server.connect(transport).catch(err => {
  console.error("[Specialists-MCP] server connection error:", err.message);
});

// Mounted at /mcp/specialists in index.js.
// Using router.all() so GET (for SSE stream) and POST (for messages) are both passed to the transport.
router.all("/", async (req, res) => {
  try {
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error("[Specialists-MCP] request failed:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
