/**
 * WordPress connector — fetches posts via the WP REST API.
 *
 * Auth: WordPress Application Password (Username + App Password).
 * Endpoint: https://yoursite.com/wp-json/wp/v2/
 */

const https = require("https");
const http = require("http");

/**
 * Validates WordPress config shape.
 */
function validate(config) {
  if (!config) throw new Error("Config is required");
  if (!config.siteUrl) throw new Error("WordPress site URL is required (e.g. https://example.com)");
  if (!config.username) throw new Error("WordPress username is required");
  if (!config.appPassword) throw new Error("WordPress Application Password is required");

  // Strip trailing slash
  config.siteUrl = config.siteUrl.replace(/\/+$/, "");

  // Must be a syntactically valid URL
  try {
    new URL(config.siteUrl);
  } catch {
    throw new Error("Invalid site URL");
  }
}

/**
 * Makes an authenticated request to the WordPress REST API.
 */
function wpRequest(siteUrl, username, appPassword, path) {
  return new Promise((resolve, reject) => {
    const url = new URL(siteUrl);
    const auth = Buffer.from(`${username}:${appPassword}`).toString("base64");
    const isHttps = url.protocol === "https:";
    const mod = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `/wp-json/wp/v2/${path}`,
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        "User-Agent": "Chronicle/1.0 (WordPress Connector)",
        Accept: "application/json",
      },
      timeout: 15000,
    };

    const req = mod.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            resolve({
              ok: false,
              error: parsed.message || parsed.code || `HTTP ${res.statusCode}`,
              statusCode: res.statusCode,
            });
          } else {
            resolve({ ok: true, data: parsed, statusCode: res.statusCode });
          }
        } catch {
          resolve({ ok: false, error: "Invalid JSON response from WordPress", raw: data.slice(0, 500) });
        }
      });
    });

    req.on("error", (err) => resolve({ ok: false, error: err.message }));
    req.on("timeout", () => { req.destroy(); resolve({ ok: false, error: "Connection timed out" }); });
    req.end();
  });
}

/**
 * Test the connection — fetch the WP site info endpoint.
 * Returns { ok: bool, error?: string }.
 */
async function test(config) {
  const result = await wpRequest(config.siteUrl, config.username, config.appPassword, "");
  if (result.ok) return { ok: true };
  return { ok: false, error: result.error };
}

/**
 * Sync — fetch published posts/pages from WordPress and return structured data.
 * Returns { ok: bool, posts: [...], error?: string }.
 */
async function sync(config) {
  const results = { posts: [], error: null };

  // Fetch posts
  const postsResult = await wpRequest(config.siteUrl, config.username, config.appPassword, "posts?per_page=100&status=publish");
  if (!postsResult.ok) {
    return { ok: false, posts: [], error: `Posts fetch failed: ${postsResult.error}` };
  }

  for (const wp of Array.isArray(postsResult.data) ? postsResult.data : []) {
    results.posts.push({
      externalId: String(wp.id),
      title: wp.title?.rendered || "Untitled",
      content: stripHtml(wp.content?.rendered || ""),
      excerpt: stripHtml(wp.excerpt?.rendered || ""),
      slug: wp.slug || "",
      url: wp.link || "",
      type: "post",
      status: wp.status || "publish",
      date: wp.date || null,
      modified: wp.modified || null,
      tags: (wp.tags || []).map(String),
      categories: (wp.categories || []).map(String),
    });
  }

  // Fetch pages
  const pagesResult = await wpRequest(config.siteUrl, config.username, config.appPassword, "pages?per_page=100&status=publish");
  if (pagesResult.ok) {
    for (const wp of Array.isArray(pagesResult.data) ? pagesResult.data : []) {
      results.posts.push({
        externalId: String(wp.id),
        title: wp.title?.rendered || "Untitled",
        content: stripHtml(wp.content?.rendered || ""),
        excerpt: stripHtml(wp.excerpt?.rendered || ""),
        slug: wp.slug || "",
        url: wp.link || "",
        type: "page",
        status: wp.status || "publish",
        date: wp.date || null,
        modified: wp.modified || null,
        tags: (wp.tags || []).map(String),
        categories: (wp.categories || []).map(String),
      });
    }
  }

  return { ok: true, posts: results.posts };
}

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")   // strip tags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = { type: "wordpress", label: "WordPress", validate, test, sync };