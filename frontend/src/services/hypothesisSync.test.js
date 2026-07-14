import { inferSourceType } from "./hypothesisSync";

test("maps chat objects to chat-import", () => {
  expect(inferSourceType({ type: "chat" })).toBe("chat-import");
});

test("maps activity objects to system-observation", () => {
  expect(inferSourceType({ type: "activity" })).toBe("system-observation");
});

test("maps everything else to explicit-input", () => {
  expect(inferSourceType({ type: "note" })).toBe("explicit-input");
  expect(inferSourceType({ type: null })).toBe("explicit-input");
});
