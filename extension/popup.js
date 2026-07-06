// Chronicle Chat Sender — popup logic (vanilla JS, MV3)

const $ = (id) => document.getElementById(id);
const statusEl = $("status");

const PROVIDERS = {
  "claude.ai": "claude",
  "chatgpt.com": "chatgpt",
  "chat.openai.com": "chatgpt",
  "gemini.google.com": "gemini",
};

function setStatus(kind, msg) {
  statusEl.className = "status " + kind;
  statusEl.textContent = msg;
}

async function getSettings() {
  const { apiUrl, token } = await chrome.storage.local.get(["apiUrl", "token"]);
  return { apiUrl, token };
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function providerForUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return PROVIDERS[host] || null;
  } catch {
    return null;
  }
}

// Runs IN the page. Best-effort DOM scraping per provider.
function scrapeConversation(provider) {
  const turns = [];
  const push = (role, el) => {
    const text = (el.innerText || "").trim();
    if (text) turns.push({ role, text });
  };

  if (provider === "claude") {
    document.querySelectorAll('[data-testid="user-message"], .font-user-message, div[data-testid], .font-claude-message').forEach(() => {});
    const userMsgs = document.querySelectorAll('[data-testid="user-message"]');
    const aiMsgs = document.querySelectorAll('.font-claude-message');
    // fall back to ordered walk
    const nodes = document.querySelectorAll('[data-testid="user-message"], .font-claude-message');
    nodes.forEach((n) => {
      const isUser = n.matches('[data-testid="user-message"]');
      push(isUser ? "user" : "assistant", n);
    });
    if (!turns.length) {
      userMsgs.forEach((n) => push("user", n));
      aiMsgs.forEach((n) => push("assistant", n));
    }
  } else if (provider === "chatgpt") {
    document.querySelectorAll('[data-message-author-role]').forEach((n) => {
      const role = n.getAttribute("data-message-author-role") === "assistant" ? "assistant" : "user";
      push(role, n);
    });
  } else if (provider === "gemini") {
    document.querySelectorAll("user-query, .query-text").forEach((n) => push("user", n));
    document.querySelectorAll("model-response, message-content, .model-response-text").forEach((n) => push("assistant", n));
    // best-effort ordered fallback
    if (!turns.length) {
      document.querySelectorAll('[class*="conversation"] [class*="text"]').forEach((n) => push("user", n));
    }
  }

  const title = document.title || "";
  return { turns, title, url: location.href };
}

function formatTurns(turns) {
  return turns
    .map((t) => `${t.role === "assistant" ? "A" : "H"}: ${t.text}`)
    .join("\n\n");
}

async function doSend() {
  const { apiUrl, token } = await getSettings();
  const tab = await activeTab();
  const provider = providerForUrl(tab.url);
  if (!provider) return setStatus("err", "Open a Claude, ChatGPT, or Gemini chat first.");

  setStatus("info", "Reading conversation…");
  $("send").disabled = true;

  let result;
  try {
    const [{ result: scraped }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeConversation,
      args: [provider],
    });
    result = scraped;
  } catch (e) {
    $("send").disabled = false;
    return setStatus("err", "Couldn't read the page. Reload the chat and retry.");
  }

  if (!result || !result.turns.length) {
    $("send").disabled = false;
    return setStatus("err", "No conversation turns found on this page.");
  }

  const content = formatTurns(result.turns);
  const title = result.turns.find((t) => t.role === "user")?.text.slice(0, 80) || result.title;

  try {
    const res = await fetch(`${apiUrl}/api/objects/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ title, content, sourceProvider: provider, url: result.url }),
    });
    if (res.status === 201) {
      setStatus("ok", `Sent ${result.turns.length} turns to Chronicle ✓`);
    } else if (res.status === 401) {
      setStatus("err", "Invalid token — check extension settings.");
    } else {
      setStatus("err", `Server error (${res.status}).`);
    }
  } catch (e) {
    setStatus("err", "Can't reach local server. Is `npm run server` running?");
  } finally {
    $("send").disabled = false;
  }
}

async function render() {
  const { apiUrl, token } = await getSettings();
  if (!apiUrl || !token) {
    $("setup").style.display = "block";
    $("main").style.display = "none";
    $("apiUrl").value = apiUrl || "http://127.0.0.1:4577";
    $("token").value = token || "";
    return;
  }
  $("setup").style.display = "none";
  $("main").style.display = "block";
  const tab = await activeTab();
  const provider = providerForUrl(tab?.url);
  $("pageInfo").textContent = provider ? `On ${provider} — ready` : "Not a supported chat page";
  $("send").disabled = !provider;
}

$("save").addEventListener("click", async () => {
  const apiUrl = $("apiUrl").value.trim().replace(/\/$/, "");
  const token = $("token").value.trim();
  if (!apiUrl || !token) return setStatus("err", "Both fields are required.");
  await chrome.storage.local.set({ apiUrl, token });
  setStatus("ok", "Saved.");
  render();
});

$("editSettings").addEventListener("click", () => {
  $("setup").style.display = "block";
  $("main").style.display = "none";
});

$("send").addEventListener("click", doSend);

render();
