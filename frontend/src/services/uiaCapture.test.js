import { isExcludedFromCapture } from "./uiaCapture";

// System chrome — should be excluded (see uiaCapture.js's SYSTEM_CHROME_PATTERNS
// comment: this is about noise, not privacy).
test("excludes Windows shell/system chrome", () => {
  expect(isExcludedFromCapture("shellhost.exe", "The system volume was muted")).toBe(true);
  expect(isExcludedFromCapture("shellhost.exe", "Clock shows 02:37 on 8-8-2026")).toBe(true);
  expect(isExcludedFromCapture("SearchHost.exe", "")).toBe(true);
  expect(isExcludedFromCapture("LockApp.exe", "")).toBe(true);
  expect(isExcludedFromCapture("Taskmgr.exe", "Task Manager")).toBe(true);
});

// Privacy — should be excluded (content the person actively signaled should
// stay private, not just noise).
test("excludes private/incognito browsing and password managers", () => {
  expect(isExcludedFromCapture("msedge.exe", "New InPrivate window")).toBe(true);
  expect(isExcludedFromCapture("chrome.exe", "Incognito tab")).toBe(true);
  expect(isExcludedFromCapture("Bitwarden.exe", "Vault")).toBe(true);
  expect(isExcludedFromCapture("KeePass.exe", "Database.kdbx")).toBe(true);
});

// Chronicle's own window — should be excluded, but only by exact appName
// match (see the regression case below for why not by title substring).
test("excludes Chronicle's own window by exact appName", () => {
  expect(isExcludedFromCapture("Chronicle.exe", "Chronicle")).toBe(true);
  expect(isExcludedFromCapture("CHRONICLE.EXE", "anything")).toBe(true); // case-insensitive
});

// Regression cases: both of these were incorrectly excluded by an earlier,
// looser version of the pattern list ("Private" and "Chronicle" as broad
// title substrings). Kept as permanent tests so a future pattern addition
// that's too broad gets caught here instead of silently blocking real
// activity again.
test("does not exclude legitimate titles that merely contain an excluded word", () => {
  // "private" is an ordinary English word, not exclusive to InPrivate mode.
  expect(isExcludedFromCapture("msedge.exe", "GitHub - private repo settings page")).toBe(false);
  // The project folder is literally named Foundation-Chronicle, so VS Code's
  // title bar contains "Chronicle" for perfectly ordinary coding activity —
  // this must never be excluded just because the title contains that word.
  expect(isExcludedFromCapture("Code.exe", "GaiaChat.jsx - Foundation-Chronicle")).toBe(false);
});

test("does not exclude ordinary apps", () => {
  expect(isExcludedFromCapture("Notepad++", "untitled - Notepad++")).toBe(false);
  expect(isExcludedFromCapture("Spotify", "Now playing")).toBe(false);
  expect(isExcludedFromCapture("msedge.exe", "GitHub")).toBe(false);
});
