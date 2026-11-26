/**
 * Cheap, deterministic pre-filter that runs BEFORE a comment is stored.
 * - "blocked": the comment is refused and never saved (links, contact details, handles).
 * - "flag": the comment is saved as pending like any other, but marked so staff review it first.
 * It never approves anything. Every comment still waits for a human.
 */
export type CommentCheck =
  | { action: "ok" }
  | { action: "blocked"; reason: string }
  | { action: "flag"; flag: string };

const BLOCKED_MESSAGE = "Links, phone numbers, emails and social handles are not allowed in comments.";

/** Lowercase, drop zero-width characters, undo common letter-for-symbol swaps and "dot"/"at" spelling. */
function normalise(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .toLowerCase()
    .replace(/\s*\(?\[?\s*dot\s*\]?\)?\s*/g, ".")
    .replace(/\s*\(?\[?\s*at\s*\]?\)?\s*(?=[a-z0-9]+\.)/g, "@");
}

const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]{2,}\.(com|net|org|io|me|ng|co|xyz|info|ly|gg|app|link|site|club|biz|tv|cc)\b)/;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/;
const HANDLE_RE = /(^|[\s(])@[a-z0-9_.]{3,}/;
const CONTACT_WORDS_RE = /\b(whats\s?app|telegram|t\.me|snap\s?chat|snapchat|insta(gram)?|cash\s?app|dm\s?me|inbox\s?me|text\s?me|call\s?me|hit\s?me\s?up)\b/;

function hasPhoneNumber(text: string): boolean {
  // 8 or more digits once separators are removed, e.g. 0803 123 4567 or +234-803-123-4567
  const digitRuns = text.match(/\+?\d[\d\s().-]{6,}\d/g) ?? [];
  return digitRuns.some((run) => run.replace(/\D/g, "").length >= 8);
}

const MINOR_WORDS_RE = /\b(under\s?-?age[d]?|minor|minors|child|children|kid|kids|teen|teens|teenager|teenage|school\s?girl|school\s?boy|schoolgirl|schoolboy|secondary\s?school|high\s?school|jss\s?[1-3]|ss\s?[1-3]|loli|lolita|pedo|paedo|pedophile|paedophile|jailbait|little\s?girl|little\s?boy)\b/;
const AGE_UNDER_18_RE = /\b(\d{1,2})\s*(yo|y\/o|yrs?|years?|year\s?old|years?\s?old)\b/g;

export function checkComment(raw: string): CommentCheck {
  const text = normalise(String(raw ?? ""));

  if (URL_RE.test(text) || EMAIL_RE.test(text) || HANDLE_RE.test(text) || CONTACT_WORDS_RE.test(text) || hasPhoneNumber(text)) {
    return { action: "blocked", reason: BLOCKED_MESSAGE };
  }

  if (MINOR_WORDS_RE.test(text)) return { action: "flag", flag: "minor_terms" };
  for (const m of text.matchAll(AGE_UNDER_18_RE)) {
    const age = Number(m[1]);
    if (age >= 1 && age < 18) return { action: "flag", flag: "minor_terms" };
  }
  return { action: "ok" };
}
