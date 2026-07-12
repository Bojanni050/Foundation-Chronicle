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
      document.querySelectorAll('[data-message-author-role]').forEach((n) => {
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
    return { turns: localTurns };
  };

  // ChatGPT groups turns with a date-separator row between them —
  // <div role="separator" aria-label="zaterdag 14:15">, statically in the
  // DOM (not a hover-only tooltip, no simulated hover needed). Turn that
  // label into an absolute ISO timestamp; collectAllTurns below tracks the
  // *last* one seen while walking top -> bottom, since that's the group
  // closest to the most recent message — the best proxy for "when did this
  // exchange happen".
  const getLastSeparatorLabel = () => {
    const labels = Array.from(document.querySelectorAll('[role="separator"][aria-label]'))
      .map((el) => el.getAttribute("aria-label"))
      .filter(Boolean);
    return labels.length ? labels[labels.length - 1] : null;
  };

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
        const day = parseInt(dutchDate[1], 10);
        const year = dutchDate[3] ? parseInt(dutchDate[3], 10) : now.getFullYear();
        let candidate = new Date(year, monthIdx, day);
        // No year in the label means "assume current year" — but ChatGPT
        // never shows a future date, so a year-less label scraped in, say,
        // January for "31 december" can only mean last December, not one
        // that hasn't happened yet. Roll back a year when that assumption
        // would otherwise land in the future.
        if (!dutchDate[3] && candidate.getTime() > now.getTime()) {
          candidate = new Date(year - 1, monthIdx, day);
        }
        return withTime(candidate);
      }
    }

    const native = new Date(label.trim());
    return isNaN(native.getTime()) ? null : native;
  };

  // Walk the whole conversation to collect every turn, not just whatever
  // was mounted when the popup opened. Also tracks the last ChatGPT
  // date-separator label seen along the way, for occurredAt below.
  let lastDateLabel = provider === "chatgpt" ? getLastSeparatorLabel() : null;
  const collectAllTurns = async () => {
    const merged = [];
    // Consecutive scroll steps overlap on purpose (so virtualization can't
    // hide anything between them), which means the same real turns show up
    // in more than one snapshot. Deduping by "have I seen this role+text
    // anywhere before" — the previous approach — also silently collapses
    // turns that are *genuinely* repeated (someone saying "ja" three times
    // in a row becomes one "ja"). Overlap-stitching instead: find how much
    // of the START of this snapshot matches the END of what's already
    // merged, and append only what comes after that overlap. That's
    // position-aware rather than content-aware, so real repeats — which
    // appear as extra entries beyond the matched overlap, not swallowed by
    // it — survive.
    const mergeIn = (snapshot) => {
      const maxOverlap = Math.min(merged.length, snapshot.length);
      let overlap = 0;
      for (let candidate = maxOverlap; candidate > 0; candidate--) {
        let matches = true;
        for (let i = 0; i < candidate; i++) {
          const a = merged[merged.length - candidate + i];
          const b = snapshot[i];
          if (a.role !== b.role || a.text !== b.text) { matches = false; break; }
        }
        if (matches) { overlap = candidate; break; }
      }
      for (let i = overlap; i < snapshot.length; i++) merged.push(snapshot[i]);

      if (provider === "chatgpt") {
        const label = getLastSeparatorLabel();
        if (label) lastDateLabel = label; // later snapshots are further down -> more recent
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
  let occurredAt = null;
  if (lastDateLabel) {
    const parsed = parseRelativeDateLabel(lastDateLabel);
    if (parsed) occurredAt = parsed.toISOString();
  }
  if (!occurredAt) {
    // Generic fallback for providers without their own extraction above
    // (e.g. Claude, which may render a real <time datetime="..."> element).
    try {
      const timeEl = document.querySelector("time, [class*='timestamp'], [class*='time']");
      const dt = timeEl && (timeEl.getAttribute("datetime") || timeEl.getAttribute("title") || timeEl.innerText);
      if (dt && dt.trim()) {
        const parsedDate = new Date(dt.trim());
        if (!isNaN(parsedDate.getTime())) occurredAt = parsedDate.toISOString();
      }
    } catch {
      // ignore
    }
  }
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
