#!/usr/bin/env node
// Guards against silent drift between logic that's intentionally duplicated
// across server (CommonJS) and frontend (ESM) so it can run identically in
// both places — see the "Both frontend and server use the same algorithm"
// comment in each pair below. There is no shared package between server/
// and frontend/ (different module systems, different build tooling), so
// nothing else catches it if one side gets edited and the other doesn't.
//
// Run manually with: node scripts/check-shared-logic-sync.js
// Exits non-zero (and fails a build/CI step, if wired in) on any drift.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const PAIRS = [
  {
    name: "providerConversationId",
    server: path.join(ROOT, "server", "providerConversationId.js"),
    frontend: path.join(ROOT, "frontend", "src", "lib", "providerConversationId.js"),
  },
  {
    name: "contentHash",
    server: path.join(ROOT, "server", "contentHash.js"),
    frontend: path.join(ROOT, "frontend", "src", "lib", "contentHash.js"),
  },
];

// Normalizes away only the module-system boilerplate that's *expected* to
// differ (CommonJS export statement vs ESM `export` keyword) — everything
// else, including comments, must match exactly.
function normalize(source) {
  return source
    .replace(/^module\.exports\s*=\s*\{[^}]*\};?\s*$/m, "")
    .replace(/^export\s+function/m, "function")
    .trim();
}

let failed = false;

for (const pair of PAIRS) {
  const serverSrc = fs.readFileSync(pair.server, "utf8");
  const frontendSrc = fs.readFileSync(pair.frontend, "utf8");

  if (normalize(serverSrc) !== normalize(frontendSrc)) {
    failed = true;
    console.error(`\n[DRIFT] "${pair.name}" differs between server and frontend:`);
    console.error(`  server:   ${pair.server}`);
    console.error(`  frontend: ${pair.frontend}`);
    console.error(`  These must stay byte-identical (aside from export syntax) — `);
    console.error(`  copy whichever one you just edited over the other.`);
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log(`✓ Shared logic in sync (${PAIRS.map((p) => p.name).join(", ")})`);
}
