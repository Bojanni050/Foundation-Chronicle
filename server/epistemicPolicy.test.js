// Plain Node, assert-based — this repo has no test framework installed
// (no jest/mocha/vitest), so these run directly: `node epistemicPolicy.test.js`.
// epistemicPolicy.js is pure (no DB), so every case here is a plain function
// call against in-memory fixtures — no Postgres needed to run these.
const assert = require("assert");
const {
  countIndependentSources,
  isVerified,
  canConfirm,
  canReject,
  confirmHypothesis,
  rejectHypothesis,
  canTransitionKnowledgeGap,
  transitionKnowledgeGap,
} = require("./epistemicPolicy");

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("independence: two extractions from the same chat count as one source", () => {
  const evidence = [
    { richting: "supporting", conversationIdentity: "chatgpt:abc", bronObjectId: "obj_1" },
    { richting: "supporting", conversationIdentity: "chatgpt:abc", bronObjectId: "obj_1" },
  ];
  assert.strictEqual(countIndependentSources(evidence), 1);

  const result = isVerified(evidence, { minIndependentSources: 2 });
  assert.strictEqual(result.independentSupportingCount, 1);
  assert.strictEqual(result.verified, false, "one chat repeated twice must not satisfy a 2-source bar");
});

test("no auto-promotion: meeting verification criteria never changes hypothesis.status", () => {
  const hypothesis = { id: "h1", status: "open" };
  const evidence = [
    { richting: "supporting", conversationIdentity: "chatgpt:a", bronObjectId: "obj_a" },
    { richting: "supporting", conversationIdentity: "gemini:b", bronObjectId: "obj_b" },
  ];
  const result = isVerified(evidence, { minIndependentSources: 2 });
  assert.strictEqual(result.verified, true, "two independent supporting sources should satisfy the bar");
  // isVerified is read-only — the hypothesis object must be untouched.
  assert.strictEqual(hypothesis.status, "open");
});

test("explicit confirm/reject: only allowed from 'open', reject requires a reason", () => {
  const open = { id: "h2", status: "open" };
  assert.strictEqual(canConfirm(open), true);
  const patch = confirmHypothesis(open);
  assert.strictEqual(patch.status, "confirmed");
  assert.ok(patch.confirmedAt instanceof Date);

  const alreadyConfirmed = { id: "h3", status: "confirmed" };
  assert.strictEqual(canConfirm(alreadyConfirmed), false);
  assert.throws(() => confirmHypothesis(alreadyConfirmed));

  const openForRejection = { id: "h4", status: "open" };
  assert.strictEqual(canReject(openForRejection), true);
  assert.throws(
    () => rejectHypothesis(openForRejection, {}),
    /reden required/,
    "rejecting without a reason must throw"
  );
  const rejectPatch = rejectHypothesis(openForRejection, { reden: "contradicted by later evidence" });
  assert.strictEqual(rejectPatch.status, "rejected");
  assert.strictEqual(rejectPatch.verwerpReden, "contradicted by later evidence");
});

test("knowledge gap transitions: only the declared forward moves are allowed", () => {
  assert.strictEqual(canTransitionKnowledgeGap("unknown", "not_asked"), true);
  assert.strictEqual(canTransitionKnowledgeGap("unknown", "resolved"), true);
  assert.strictEqual(canTransitionKnowledgeGap("not_asked", "unknown"), false, "no going backwards");
  assert.strictEqual(canTransitionKnowledgeGap("resolved", "unknown"), false, "resolved is terminal");

  const gap = { id: "g1", status: "not_asked" };
  const patch = transitionKnowledgeGap(gap, "resolved");
  assert.strictEqual(patch.status, "resolved");
  assert.ok(patch.resolvedAt instanceof Date);

  assert.throws(() => transitionKnowledgeGap({ id: "g2", status: "resolved" }, "not_asked"));
});

let failures = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL - ${name}`);
    console.error(`  ${err.message}`);
  }
}

console.log(`\n${tests.length - failures}/${tests.length} passed`);
process.exit(failures > 0 ? 1 : 0);
