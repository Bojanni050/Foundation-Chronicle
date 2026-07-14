import { isValidReflectionCandidate } from "./hypothesisReflectionSync";

const activeFactIds = new Set(["fact_a", "fact_b"]);

test("accepts a genuine-change candidate against a known active fact", () => {
  expect(
    isValidReflectionCandidate(
      { targetFactId: "fact_a", hypothese: "x", classification: "echte_wijziging" },
      activeFactIds
    )
  ).toBe(true);
});

test("accepts a genuine-contradiction candidate", () => {
  expect(
    isValidReflectionCandidate(
      { targetFactId: "fact_b", hypothese: "x", classification: "echte_contradictie" },
      activeFactIds
    )
  ).toBe(true);
});

test("rejects any other classification, even with a valid target", () => {
  for (const classification of ["tijdelijke_toestand", "contextafhankelijke_variant", "uitzondering", "interpretatiefout"]) {
    expect(isValidReflectionCandidate({ targetFactId: "fact_a", hypothese: "x", classification }, activeFactIds)).toBe(
      false
    );
  }
});

test("rejects a hallucinated fact id not in the active set", () => {
  expect(
    isValidReflectionCandidate(
      { targetFactId: "fact_nonexistent", hypothese: "x", classification: "echte_wijziging" },
      activeFactIds
    )
  ).toBe(false);
});

test("rejects a candidate missing hypothese text", () => {
  expect(isValidReflectionCandidate({ targetFactId: "fact_a", classification: "echte_wijziging" }, activeFactIds)).toBe(
    false
  );
});
