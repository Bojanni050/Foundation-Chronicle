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
// Requires vendor/turndown.js + vendor/turndown-plugin-gfm.js to already be
// injected into this tab (doSend does that first) — TurndownService and
// turndownPluginGfm are page globals set by those UMD builds, not imports,
// since this function is shipped to the page as serialized source via
// chrome.scripting.executeScript rather than bundled.
async function scrapeConversation(provider) {
  const turndownService = (() => {
    try {
      const svc = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        bulletListMarker: "-",
        emDelimiter: "*",
        strongDelimiter: "**",
      });
      if (typeof turndownPluginGfm !== "undefined") svc.use(turndownPluginGfm.gfm);
      return svc;
    } catch {
      return null; // vendor scripts failed to load — fall back to innerText below
    }
  })();
  // Converts a message's HTML to Markdown via turndown, which handles code
  // blocks, lists, tables, links and emphasis far more faithfully than a
  // hand-rolled walker. Falls back to plain innerText (unstructured but
  // never empty) if the vendored library didn't load for some reason.
  const nodeToMarkdown = (root) => {
    if (turndownService) {
      try {
        return turndownService.turndown(root).trim();
      } catch {
        // fall through to innerText
      }
    }
    return (root.innerText || "").trim();
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

  // Reads whatever message turns are *currently mounted* in the DOM. Called
  // repeatedly while auto-scrolling below, since long conversations are
  // virtualized (ChatGPT, Claude, Gemini all unmount off-screen messages) —
  // a single snapshot only ever sees whatever happened to be rendered when
  // the popup was opened, which is why exporting used to silently drop the
  // rest of the chat and "scroll then re-export" surfaced different turns.
  const snapshotTurns = (providerName) => {
    const localTurns = [];
    const push = (role, el) => {
      const text = nodeToMarkdown(el);
      if (text) localTurns.push({ role, text });
    };
    let messageNodes = null;
    if (providerName === "claude") {
      const nodes = leavesOnly(document.querySelectorAll('[data-testid="user-message"], .font-claude-message'));
      nodes.forEach((n) => {
        const isUser = n.matches('[data-testid="user-message"]');
        push(isUser ? "user" : "assistant", n);
      });
      if (!localTurns.length) {
        leavesOnly(document.querySelectorAll('[data-testid="user-message"]')).forEach((n) => push("user", n));
        leavesOnly(document.querySelectorAll('.font-claude-message')).forEach((n) => push("assistant", n));
      }
    } else if (providerName === "chatgpt") {
      messageNodes = Array.from(document.querySelectorAll('[data-message-author-role]'));
      messageNodes.forEach((n) => {
        const role = n.getAttribute("data-message-author-role") === "assistant" ? "assistant" : "user";
        push(role, n);
      });
    } else if (providerName === "gemini") {
      leavesOnly(document.querySelectorAll("user-query, .query-text")).forEach((n) => push("user", n));
      leavesOnly(document.querySelectorAll("model-response, message-content, .model-response-text")).forEach((n) => push("assistant", n));
      // best-effort ordered fallback
      if (!localTurns.length) {
        document.querySelectorAll('[class*="conversation"] [class*="text"]').forEach((n) => push("user", n));
      }
    }
    return { turns: localTurns, messageNodes };
  };

  // Snapshot at whatever scroll position the chat was already at (normally
  // the bottom / most recent messages) before any auto-scrolling below moves
  // it — that's the best position for reading ChatGPT's relative-date
  // tooltip, since it's about the most recent exchange.
  const initialSnapshot = snapshotTurns(provider);
  const chatgptMessageNodes = provider === "chatgpt" ? initialSnapshot.messageNodes : null;

  // ChatGPT doesn't expose a real <time> element in the conversation view —
  // instead each message has a hover-only tooltip showing a relative label
  // ("Vandaag 16:05", "Gisteren 16:05", or a weekday name like "maandag
  // 16:05" for the past week, full dates beyond that). Turn one of those
  // labels into an absolute ISO timestamp, newest message first since that's
  // the best proxy for "when did this exchange happen".
  const parseRelativeDateLabel = (label, now = new Date()) => {
    if (!label) return null;
    const text = label.trim().toLowerCase();
    const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
    const hours = timeMatch ? parseInt(timeMatch[1], 10) : null;
    const minutes = timeMatch ? parseInt(timeMatch[2], 10) : null;
    const withTime = (d) => {
      const r = new Date(d);
      if (hours !== null) r.setHours(hours, minutes, 0, 0);
      return r;
    };

    if (/^(vandaag|today)\b/.test(text)) return withTime(now);
    if (/^(gisteren|yesterday)\b/.test(text)) {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return withTime(d);
    }

    // Sun..Sat, same index in both languages so weekday name -> getDay().
    const WEEKDAYS = [
      ["zondag", "sunday"], ["maandag", "monday"], ["dinsdag", "tuesday"],
      ["woensdag", "wednesday"], ["donderdag", "thursday"], ["vrijdag", "friday"],
      ["zaterdag", "saturday"],
    ];
    const targetDow = WEEKDAYS.findIndex(([nl, en]) => text.startsWith(nl) || text.startsWith(en));
    if (targetDow !== -1) {
      const d = new Date(now);
      const diff = (d.getDay() - targetDow + 7) % 7; // most recent past occurrence, 0 = today
      d.setDate(d.getDate() - diff);
      return withTime(d);
    }

    // Dutch full date fallback, e.g. "11 juli 2026" / "11 jul."
    const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
    const dutchDate = text.match(/(\d{1,2})\s+([a-zé]+)\.?\s*(\d{4})?/);
    if (dutchDate) {
      const monthIdx = MONTHS.findIndex((m) => m.startsWith(dutchDate[2]));
      if (monthIdx !== -1) {
        const year = dutchDate[3] ? parseInt(dutchDate[3], 10) : now.getFullYear();
        return withTime(new Date(year, monthIdx, parseInt(dutchDate[1], 10)));
      }
    }

    const native = new Date(label.trim());
    return isNaN(native.getTime()) ? null : native;
  };

  let occurredAt = null;
  try {
    if (chatgptMessageNodes && chatgptMessageNodes.length) {
      // Best-effort: ChatGPT's timestamp is usually only rendered on hover
      // (a portal-based tooltip), so it may not be in the DOM at all for a
      // one-shot scrape. This checks for the label wherever ChatGPT happens
      // to expose it statically (title/aria-label near a message, or an
      // already-open tooltip) without simulating a hover.
      const RELATIVE_RE = /^(vandaag|gisteren|today|yesterday|zondag|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;
      const candidateContainers = [...chatgptMessageNodes].reverse()
        .map((n) => n.closest("article") || n.parentElement || n);
      candidateContainers.push(document.body); // last resort: an open tooltip anywhere on the page
      outer: for (const container of candidateContainers) {
        const labelEls = container.querySelectorAll('[title], [aria-label], [role="tooltip"]');
        for (const el of labelEls) {
          const raw = el.getAttribute("title") || el.getAttribute("aria-label") || el.textContent;
          const val = raw && raw.trim();
          if (val && (RELATIVE_RE.test(val) || /\d{1,2}:\d{2}/.test(val))) {
            const parsed = parseRelativeDateLabel(val);
            if (parsed) { occurredAt = parsed.toISOString(); break outer; }
          }
        }
      }
    }
    if (!occurredAt) {
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
    }
  } catch (err) {
    // ignore
  }

  // Walk the whole conversation to collect every turn, not just whatever
  // was mounted when the popup opened. Merges by content so re-mounted
  // duplicates from virtualization collapse into one.
  const collectAllTurns = async () => {
    const seenKeys = new Set();
    const merged = [];
    const mergeIn = (snapshot) => {
      for (const t of snapshot) {
        const key = t.role + "::" + t.text;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          merged.push(t);
        }
      }
    };
    // Deliberately NOT seeded from initialSnapshot: that snapshot is taken
    // at whatever scroll position the chat happened to be at (normally the
    // bottom/most recent messages), and merging it in first would push the
    // newest messages to the front of `merged` once the top-to-bottom walk
    // below appends the earlier ones after them — turns would come back
    // out of chronological order. Every turn instead comes from this walk,
    // which always proceeds top -> bottom, so first-seen order stays
    // chronological.

    const anyMsg = document.querySelector(
      '[data-message-author-role], [data-testid="user-message"], .font-claude-message, user-query, model-response'
    );
    let scrollEl = document.scrollingElement || document.documentElement;
    let el = anyMsg && anyMsg.parentElement;
    while (el) {
      const style = getComputedStyle(el);
      if ((style.overflowY === "auto" || style.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 4) {
        scrollEl = el;
        break;
      }
      el = el.parentElement;
    }

    const originalScrollTop = scrollEl.scrollTop;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    try {
      // Long chats lazy-load older history as you scroll toward the top, so
      // scrolling to 0 once isn't enough — keep nudging up until scrollHeight
      // stops growing (no more history loading in above what's mounted).
      let lastScrollHeight = -1;
      for (let i = 0; i < 60; i++) {
        scrollEl.scrollTop = 0;
        await wait(350);
        if (scrollEl.scrollHeight === lastScrollHeight) break;
        lastScrollHeight = scrollEl.scrollHeight;
      }

      // Now walk back down to the bottom in small, overlapping steps,
      // collecting whatever virtualization has (re)mounted at each stop.
      // Termination is purely "reached the bottom" — deliberately NOT "no
      // new turns showed up the last few rounds": a single long message
      // (e.g. a big code block) can span several scroll steps without ever
      // producing a *new* turn, which would trip a stagnation-based exit
      // and silently truncate everything below it.
      scrollEl.scrollTop = 0;
      await wait(200);
      mergeIn(snapshotTurns(provider).turns);
      for (let i = 0; i < 500; i++) {
        const atBottom = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 4;
        if (atBottom) { mergeIn(snapshotTurns(provider).turns); break; }
        scrollEl.scrollTop = Math.min(scrollEl.scrollTop + scrollEl.clientHeight * 0.5, scrollEl.scrollHeight);
        await wait(280);
        mergeIn(snapshotTurns(provider).turns);
      }
    } finally {
      scrollEl.scrollTop = originalScrollTop; // leave the page as we found it
    }

    return merged;
  };

  const turns = await collectAllTurns();
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

  setStatus("info", "Reading conversation… (scrolling through full history, keep this popup open)");
  $("send").disabled = true;

  let result;
  try {
    // Vendored UMD builds, injected as plain scripts so scrapeConversation
    // (shipped separately as serialized source) can reach them as page
    // globals — see the comment on scrapeConversation for why.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["vendor/turndown.js", "vendor/turndown-plugin-gfm.js"],
    });
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
