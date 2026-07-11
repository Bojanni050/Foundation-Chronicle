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
  // Plain innerText collapses lists, code blocks, and emphasis into one
  // unstructured blob. Chronicle's note view is plain text (no markdown
  // renderer), so this doesn't produce rich formatting — but markdown-style
  // conventions (fenced code, "- " list markers, blank-line paragraphs) stay
  // legible even unrendered and preserve the structure that innerText loses.
  const nodeToMarkdown = (root) => {
    let out = "";
    const listStack = [];
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        // Skip whitespace-only text nodes that contain a newline — those are
        // indentation between tags in the source markup, not real inline
        // spacing (real spacing between inline elements is a single space
        // with no newline, e.g. "bold <em>text</em>").
        if (/^\s*$/.test(node.textContent) && node.textContent.includes("\n")) return;
        out += node.textContent;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "noscript") return;
      if (tag === "br") { out += "\n"; return; }
      if (tag === "pre") {
        out += "\n```\n" + node.textContent.replace(/\s+$/, "") + "\n```\n";
        return;
      }
      if (tag === "code" && !node.closest("pre")) {
        out += "`" + node.textContent + "`";
        return;
      }
      if (tag === "strong" || tag === "b") {
        out += "**"; node.childNodes.forEach(walk); out += "**";
        return;
      }
      if (tag === "em" || tag === "i") {
        out += "*"; node.childNodes.forEach(walk); out += "*";
        return;
      }
      if (tag === "a") {
        const start = out.length;
        node.childNodes.forEach(walk);
        const text = out.slice(start).trim();
        const href = node.getAttribute("href");
        if (href && href.startsWith("http") && text && !text.includes(href)) {
          out = out.slice(0, start) + `${text} (${href})`;
        }
        return;
      }
      if (tag === "ul" || tag === "ol") {
        listStack.push({ ordered: tag === "ol", index: 1 });
        out += "\n";
        node.childNodes.forEach(walk);
        listStack.pop();
        out += "\n";
        return;
      }
      if (tag === "li") {
        const ctx = listStack[listStack.length - 1];
        out += "\n" + (ctx && ctx.ordered ? `${ctx.index++}. ` : "- ");
        node.childNodes.forEach(walk);
        return;
      }
      if (/^h[1-6]$/.test(tag)) {
        out += "\n" + "#".repeat(Number(tag[1])) + " ";
        node.childNodes.forEach(walk);
        out += "\n";
        return;
      }
      if (tag === "blockquote") {
        const start = out.length;
        node.childNodes.forEach(walk);
        const inner = out.slice(start).trim();
        out = out.slice(0, start) + inner.split("\n").map((l) => "> " + l).join("\n") + "\n";
        return;
      }
      const isBlock = ["p", "div", "section", "article", "table", "tr", "td", "th"].includes(tag);
      if (isBlock) out += "\n";
      node.childNodes.forEach(walk);
      if (isBlock) out += "\n";
    };
    walk(root);
    return out.replace(/\n{3,}/g, "\n\n").trim();
  };
  const push = (role, el) => {
    const text = nodeToMarkdown(el);
    if (text) turns.push({ role, text });
  };
  // Some multi-selector queries match nested elements for the same logical
  // message (e.g. Gemini's model-response wrapper AND its inner
  // message-content/.model-response-text) — querySelectorAll doesn't dedupe
  // ancestor+descendant matches, so each nesting level was getting pushed as
  // its own turn with the same (or overlapping) text. Keep only the
  // innermost match per set so a turn is captured once.
  const leavesOnly = (nodeList) => {
    const nodes = Array.from(nodeList);
    return nodes.filter((n) => !nodes.some((other) => other !== n && n.contains(other)));
  };

  if (provider === "claude") {
    const nodes = leavesOnly(document.querySelectorAll('[data-testid="user-message"], .font-claude-message'));
    nodes.forEach((n) => {
      const isUser = n.matches('[data-testid="user-message"]');
      push(isUser ? "user" : "assistant", n);
    });
    if (!turns.length) {
      leavesOnly(document.querySelectorAll('[data-testid="user-message"]')).forEach((n) => push("user", n));
      leavesOnly(document.querySelectorAll('.font-claude-message')).forEach((n) => push("assistant", n));
    }
  } else if (provider === "chatgpt") {
    document.querySelectorAll('[data-message-author-role]').forEach((n) => {
      const role = n.getAttribute("data-message-author-role") === "assistant" ? "assistant" : "user";
      push(role, n);
    });
  } else if (provider === "gemini") {
    leavesOnly(document.querySelectorAll("user-query, .query-text")).forEach((n) => push("user", n));
    leavesOnly(document.querySelectorAll("model-response, message-content, .model-response-text")).forEach((n) => push("assistant", n));
    // best-effort ordered fallback
    if (!turns.length) {
      document.querySelectorAll('[class*="conversation"] [class*="text"]').forEach((n) => push("user", n));
    }
  }

  let occurredAt = null;
  try {
    const timeEl = document.querySelector('time, [class*="timestamp"], [class*="time"]');
    if (timeEl) {
      const dt = timeEl.getAttribute('datetime') || timeEl.getAttribute('title') || timeEl.innerText;
      if (dt && dt.trim()) {
        const parsedDate = new Date(dt.trim());
        if (!isNaN(parsedDate.getTime())) {
          occurredAt = parsedDate.toISOString();
        }
      }
    }
  } catch (err) {
    // ignore
  }
  const title = document.title || "";
  return { turns, title, url: location.href, occurredAt };
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
      body: JSON.stringify({
        title,
        content,
        turns: result.turns, // structured role/text, for message-level embedding server-side
        sourceProvider: provider,
        url: result.url,
        occurredAt: result.occurredAt,
      }),
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
