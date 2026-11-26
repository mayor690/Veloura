import test from "node:test";
import assert from "node:assert/strict";
import { checkComment } from "./comment-filter";

test("plain comments pass", () => {
  assert.deepEqual(checkComment("Great story, thanks for sharing"), { action: "ok" });
  assert.deepEqual(checkComment("I tried this 3 times and it worked"), { action: "ok" });
});

test("links, emails, handles, phone numbers and contact words are blocked", () => {
  for (const t of [
    "check https://example.com now",
    "visit www.example.ng",
    "go to mysite.com",
    "mail me at jo@example.com",
    "follow @someone_cool",
    "call 0803 123 4567",
    "+234-803-123-4567",
    "add me on whatsapp",
    "dm me please",
    "my site is example dot com",
  ]) {
    assert.equal(checkComment(t).action, "blocked", t);
  }
});

test("zero-width tricks do not get through", () => {
  assert.equal(checkComment("exam\u200Bple.com").action, "blocked");
});

test("ages and minor-related words are flagged, not refused", () => {
  for (const t of ["she was 16 years old", "17yo", "a teenager did this", "secondary school days", "underage"]) {
    const r = checkComment(t);
    assert.equal(r.action, "flag", t);
    if (r.action === "flag") assert.equal(r.flag, "minor_terms");
  }
});

test("adult ages are not flagged", () => {
  assert.deepEqual(checkComment("we are both 25 years old"), { action: "ok" });
});
