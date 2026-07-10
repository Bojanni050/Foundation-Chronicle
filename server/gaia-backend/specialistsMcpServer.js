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
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
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

// A fresh McpServer + tool registration per request — cheap (no long-lived
// state), and guarantees ListTools always reflects the current confirmed set.
async function buildServer() {
  const server = new McpServer({ name: "chronicle-specialists", version: "1.0.0" });
  const specialists = await getConfirmedSpecialists();
  for (const s of specialists) {
    const toolName = `ask_${slugify(s.onderwerp)}_specialist`;
    server.registerTool(
      toolName,
      {
        description: `Ask a specialist focused on "${s.onderwerp}" a specific question. Use this instead of guessing when the question is specifically about ${s.onderwerp}.`,
        inputSchema: { question: z.string().describe("The focused question to hand to the specialist.") },
      },
      async ({ question }) => {
        try {
          const answer = await askSpecialist(s, question);
          return { content: [{ type: "text", text: answer }] };
        } catch (err) {
          return { content: [{ type: "text", text: `De specialist-aanroep faalde: ${err.message}` }], isError: true };
        }
      }
    );
  }
  return server;
}

// Stateless streamable-HTTP MCP endpoint (sessionIdGenerator: undefined —
// no session state to keep, matches the "fresh tool list every call" design
// above). Mounted at /mcp/specialists in index.js.
router.post("/", async (req, res) => {
  try {
    const server = await buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    // No parsedBody: this router is mounted before express.json() runs (see
    // index.js), specifically so the transport can read the raw request
    // stream itself instead of racing an already-consumed one.
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error("[Specialists-MCP] request failed:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
