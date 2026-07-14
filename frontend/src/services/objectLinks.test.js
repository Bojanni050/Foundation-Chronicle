import { backlinksFor, linkCandidates, normalizeObjectLinks } from "./objectLinks";

const objects = [
  { id: "a", title: "Alpha", content: "First note", tags: ["start"], links: ["b"], updatedAt: "2026-01-01" },
  { id: "b", title: "Beta project", content: "Roadmap", tags: ["work"], links: [], updatedAt: "2026-01-03" },
  { id: "c", title: "Gamma", content: "Mentions beta", tags: [], links: ["b", "missing"], updatedAt: "2026-01-02" },
];

test("normalizes links without self-links, duplicates, or invalid ids", () => {
  expect(normalizeObjectLinks(["b", "a", "b", null, ""], "a")).toEqual(["b"]);
});

test("finds backlinks in most-recent order", () => {
  expect(backlinksFor(objects, "b").map((object) => object.id)).toEqual(["c", "a"]);
});

test("searches candidates and excludes the current and linked objects", () => {
  expect(linkCandidates(objects, { currentId: "a", linkedIds: ["c"], query: "project" }).map((object) => object.id)).toEqual(["b"]);
});
