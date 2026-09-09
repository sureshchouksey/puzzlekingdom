import { env } from "../src/env.js";
import { getGeminiClient } from "../src/services/providers/gemini.js";
import { classifyTutorIntent, heuristicClassifyTutorIntent, type TutorIntent } from "../src/services/tutorIntent.js";

// Test engine for tutorIntent.ts - the NLP classifier that decides
// whether a child's chat message is a greeting, thanks, a request to
// play, a request to reveal an answer, an attempt at answering a pending
// riddle/joke/puzzle/trivia question (right or wrong), or a genuine
// academic question. This is the single riskiest piece of the Study
// Buddy "friendly chat" feature (plan/AI-Study-Mentor-Agent-Plan.md) -
// misclassify it and a child either gets stonewalled with the honest
// "I don't know that yet" fallback for an obvious play request, or has a
// real lesson question hijacked by the fun-content path. It has already
// broken twice in ways that only showed up through live testing (a
// silently mangled regex, and a missing "is this an answer, not a
// question" case) - this script exists so those regressions get caught
// here instead of by a child clicking around.
//
// Two separate passes over the SAME case list:
//
//   1. HEURISTIC (offline, deterministic, free) - calls
//      heuristicClassifyTutorIntent directly. This is the safety-net path
//      that runs whenever Gemini itself is unreachable (see
//      tutorIntent.ts's own doc comment) - keyword/regex matching, no
//      real language understanding. A handful of cases are deliberately
//      marked `heuristicMayMiss: true` for genuinely hard cases (a
//      digit-vs-word answer like "eight" vs "8", or a real unrelated
//      question that happens to arrive while a riddle is pending) - the
//      heuristic is allowed to get the CONTENT (kind) reasonably close
//      without being held to the same bar as real NLP; see each case's
//      `note` for why.
//
//   2. LIVE (classifyTutorIntent - real Gemini call, same call path the
//      actual chat route uses) - every case is asserted in full,
//      including the heuristicMayMiss ones. This is the whole reason the
//      feature uses a real model instead of keyword matching (context-
//      aware disambiguation - "a coin" only means something right after
//      being asked a riddle about a coin) - if this pass can't get the
//      hard cases right either, that's a real prompt/schema bug, not an
//      acceptable heuristic shortfall.
//
// Before the live pass, pings Gemini directly with a trivial call and
// prints whether the configured GEMINI_API_KEY is actually working. If
// it isn't, classifyTutorIntent's own fallback machinery means the "live"
// pass silently re-runs the heuristic under the hood - this script says
// so plainly rather than let a passing "live" section be mistaken for
// real NLP coverage when it wasn't.
//
// Run from apps/api:
//   npx tsx --env-file=.env scripts/test-tutor-intent.ts

interface TestCase {
  label: string;
  message: string;
  pending?: { promptText: string; answerText: string; offeredReveal?: boolean };
  expectedKind: TutorIntent["kind"];
  expectedContentType?: Extract<TutorIntent, { kind: "fun_request" }>["contentType"];
  expectedSubject?: "science" | "english" | "maths";
  expectedCorrect?: boolean;
  heuristicMayMiss?: boolean;
  note?: string;
}

// Real content from scripts/seed-fun-content.ts, not invented for this
// test - the answer_attempt cases below check against exactly what a
// child would actually be shown, same "grounded, not invented" spirit as
// the rest of this project's Gemini-facing code.
const COIN_RIDDLE = { promptText: "I have a head and a tail, but no body. What am I?", answerText: "A coin." };
const TOWEL_RIDDLE = { promptText: "What gets wetter and wetter the more it dries?", answerText: "A towel." };
const SPONGE_RIDDLE = { promptText: "I am full of holes, but I can still hold water. What am I?", answerText: "A sponge." };
const EGG_RIDDLE = { promptText: "What has to be broken before you can use it?", answerText: "An egg." };
const UMBRELLA_RIDDLE = { promptText: "What goes up when rain comes down?", answerText: "An umbrella." };
const DAVID_RIDDLE = {
  promptText: "David's parents have three sons: Snap, Crackle, and what is the name of the third son?",
  answerText: "David! Read it again - the riddle already told you his name.",
};
const NUMBER_8_RIDDLE = {
  promptText: "What number can you cut exactly in half to get two zeros, and turn on its side to get infinity?",
  answerText: "The number 8! Cut it in half and you get two 0s; turn it on its side and it looks like the infinity symbol.",
};
const LETTER_M_RIDDLE = {
  promptText: "What appears once in a minute, twice in a moment, but never in a thousand years?",
  answerText: "The letter M.",
};
const POST_OFFICE_RIDDLE = {
  promptText: "What begins with P, ends with E, and has thousands of letters?",
  answerText: "The Post Office!",
};
const MATH_BOOK_JOKE = { promptText: "Why did the math book look so sad?", answerText: "Because it had too many problems!" };
// Same coin riddle, but in the "already guessed wrong once" state - i.e.
// the child was just asked "want a hint, or should I tell you the
// answer?" (see tutor.ts's INCORRECT_GUESS_REPLIES / 'reveal_offer').
const COIN_RIDDLE_OFFERED_REVEAL = { ...COIN_RIDDLE, offeredReveal: true };

const CASES: TestCase[] = [
  // --- Greetings ---
  { label: "greeting: bare hi", message: "hi", expectedKind: "greeting" },
  { label: "greeting: Hi!", message: "Hi!", expectedKind: "greeting" },
  { label: "greeting: hello", message: "hello", expectedKind: "greeting" },
  { label: "greeting: heyyy", message: "heyyy", expectedKind: "greeting" },
  { label: "greeting: good morning", message: "good morning", expectedKind: "greeting" },
  {
    label: "NOT a bare greeting - has a real ask folded in",
    message: "hi, can you help me with fractions",
    expectedKind: "academic",
    note: "starts with a greeting word but isn't just a greeting - should fall through to academic",
  },

  // --- Thanks ---
  { label: "thanks: bare", message: "thanks!", expectedKind: "thanks" },
  { label: "thanks: thank you so much", message: "thank you so much", expectedKind: "thanks" },
  { label: "thanks: ty", message: "ty", expectedKind: "thanks" },

  // --- Fun requests ---
  { label: "fun: give me a riddle", message: "Give me a riddle!", expectedKind: "fun_request", expectedContentType: "riddle" },
  { label: "fun: riddle please, lowercase", message: "riddle please", expectedKind: "fun_request", expectedContentType: "riddle" },
  { label: "fun: tell me a joke", message: "Tell me a joke!", expectedKind: "fun_request", expectedContentType: "joke" },
  { label: "fun: tongue twister", message: "Give me a tongue twister!", expectedKind: "fun_request", expectedContentType: "tongue_twister" },
  { label: "fun: puzzle", message: "got a puzzle for me?", expectedKind: "fun_request", expectedContentType: "puzzle" },
  { label: "fun: trivia + science", message: "quiz me on science", expectedKind: "fun_request", expectedContentType: "trivia", expectedSubject: "science" },
  { label: "fun: trivia + english", message: "ask me an english question", expectedKind: "fun_request", expectedContentType: "trivia", expectedSubject: "english" },
  {
    label: "fun: bare play request, no type named",
    message: "can we play a game?",
    expectedKind: "fun_request",
    note: "no specific type named - just checking kind, not which type gets picked (heuristic/Gemini both pick one at random)",
  },
  { label: "fun: I'm bored", message: "I'm bored", expectedKind: "fun_request" },

  // --- Reveal answer (no pending question in context) ---
  { label: "reveal: I give up", message: "I give up", expectedKind: "reveal_answer" },
  { label: "reveal: what's the answer", message: "what's the answer?", expectedKind: "reveal_answer" },
  { label: "reveal: I don't know", message: "I don't know", expectedKind: "reveal_answer" },
  { label: "reveal: idk", message: "idk", expectedKind: "reveal_answer" },

  // --- Hint requests ---
  {
    label: "hint: I want a hint, right after a fresh riddle",
    message: "I want a hint",
    pending: SPONGE_RIDDLE,
    expectedKind: "hint_request",
    note: "regression case - previously fell through to the answer_attempt fallback and got graded as a wrong guess (\"Good try, but that's not it!\") even though the child never guessed anything",
  },
  { label: "hint: give me a hint", message: "give me a hint", pending: SPONGE_RIDDLE, expectedKind: "hint_request" },
  { label: "hint: can I have a clue", message: "can I have a clue?", pending: SPONGE_RIDDLE, expectedKind: "hint_request" },
  {
    label: "hint: after already being offered one (offeredReveal true)",
    message: "hint please",
    pending: COIN_RIDDLE_OFFERED_REVEAL,
    expectedKind: "hint_request",
    note: "a hint request should win out over the offeredReveal-gated affirmative path - 'hint please' isn't a bare yes/sure/ok",
  },
  {
    label: "hint request with no pending question at all",
    message: "give me a hint",
    expectedKind: "hint_request",
    note: "tutor.ts's own lenient findMostRecentFunContentItem lookup (not pending) is what resolves which item to hint at, so this should still classify as hint_request even without a strict pending context - it's an explicit, unambiguous request either way",
  },

  // --- Answer attempts (pending question in context) ---
  { label: "answer: coin, correct, exact", message: "a coin", pending: COIN_RIDDLE, expectedKind: "answer_attempt", expectedCorrect: true },
  { label: "answer: coin, correct, phrased", message: "It's a coin!", pending: COIN_RIDDLE, expectedKind: "answer_attempt", expectedCorrect: true },
  { label: "answer: coin, correct, shouted", message: "COIN", pending: COIN_RIDDLE, expectedKind: "answer_attempt", expectedCorrect: true },
  { label: "answer: coin, wrong", message: "a dog", pending: COIN_RIDDLE, expectedKind: "answer_attempt", expectedCorrect: false },
  { label: "answer: towel, correct", message: "a towel", pending: TOWEL_RIDDLE, expectedKind: "answer_attempt", expectedCorrect: true },
  {
    label: "answer: towel, wrong but topically close",
    message: "a sponge",
    pending: TOWEL_RIDDLE,
    expectedKind: "answer_attempt",
    expectedCorrect: false,
    note: "another real riddle's answer, but wrong for THIS riddle - checks it's compared against the actual pending answer, not just 'sounds plausible'",
  },
  { label: "answer: sponge, correct", message: "a sponge", pending: SPONGE_RIDDLE, expectedKind: "answer_attempt", expectedCorrect: true },
  { label: "answer: egg, correct", message: "an egg", pending: EGG_RIDDLE, expectedKind: "answer_attempt", expectedCorrect: true },
  { label: "answer: umbrella, wrong", message: "a raincoat", pending: UMBRELLA_RIDDLE, expectedKind: "answer_attempt", expectedCorrect: false },
  { label: "answer: David, correct", message: "David", pending: DAVID_RIDDLE, expectedKind: "answer_attempt", expectedCorrect: true },
  { label: "answer: letter M, correct", message: "the letter M", pending: LETTER_M_RIDDLE, expectedKind: "answer_attempt", expectedCorrect: true },
  { label: "answer: post office, correct", message: "the post office", pending: POST_OFFICE_RIDDLE, expectedKind: "answer_attempt", expectedCorrect: true },
  {
    label: "answer: number 8, correct but as a word not a digit",
    message: "eight",
    pending: NUMBER_8_RIDDLE,
    expectedKind: "answer_attempt",
    expectedCorrect: true,
    heuristicMayMiss: true,
    note: "'eight' vs '8' - the heuristic's plain substring match doesn't know these are the same number; real NLP should",
  },
  {
    label: "answer: math book joke, correct punchline",
    message: "too many problems",
    pending: MATH_BOOK_JOKE,
    expectedKind: "answer_attempt",
    expectedCorrect: true,
  },
  {
    label: "reveal takes priority over answer_attempt when pending",
    message: "I don't know, what is it?",
    pending: COIN_RIDDLE,
    expectedKind: "reveal_answer",
    note: "giving up should still be recognized as reveal_answer even with a pending question, not swept into a wrong guess",
  },
  {
    label: "a genuine unrelated question should NOT be hijacked by a pending riddle",
    message: "how do you multiply fractions",
    pending: COIN_RIDDLE,
    expectedKind: "academic",
    heuristicMayMiss: true,
    note: "short enough to fool the heuristic's length-based fallback into treating it as a guess - this is exactly the kind of case real NLP (context understanding, not just message length) is needed for",
  },
  {
    label: "reveal: give me answer, right after a fresh riddle",
    message: "give me answer",
    pending: COIN_RIDDLE,
    expectedKind: "reveal_answer",
    note: "regression case - previously fell through REVEAL_PATTERN (only 'tell me the answer' was covered) and got misclassified as a wrong answer_attempt guess instead",
  },
  {
    label: "reveal: give me the answer, right after a fresh riddle",
    message: "give me the answer",
    pending: COIN_RIDDLE,
    expectedKind: "reveal_answer",
  },
  {
    label: "reveal: bare 'yes' accepting a just-offered hint/answer",
    message: "yes",
    pending: COIN_RIDDLE_OFFERED_REVEAL,
    expectedKind: "reveal_answer",
    note: "regression case - a bare affirmative after 'want a hint, or should I tell you the answer?' previously wasn't recognized at all and fell all the way through to the academic honest-fallback reply",
  },
  {
    label: "reveal: 'yeah' accepting a just-offered hint/answer",
    message: "yeah",
    pending: COIN_RIDDLE_OFFERED_REVEAL,
    expectedKind: "reveal_answer",
  },
  {
    label: "answer: another guess after a just-offered hint/answer is still graded, not swept into reveal",
    message: "a button",
    pending: COIN_RIDDLE_OFFERED_REVEAL,
    expectedKind: "answer_attempt",
    expectedCorrect: false,
    note: "offeredReveal should only special-case a short affirmative/reveal phrasing - a genuine second guess still needs grading against the pending answer",
  },
  {
    label: "a bare 'yes' with NO reveal offer pending is just a guess, not a reveal request",
    message: "yes",
    pending: COIN_RIDDLE,
    expectedKind: "answer_attempt",
    expectedCorrect: false,
    note: "offeredReveal is false here (this is the original question, not the post-wrong-guess offer) - AFFIRMATIVE_PATTERN must stay gated on offeredReveal, not fire on any pending question",
  },

  // --- Academic (no pending) ---
  { label: "academic: arithmetic", message: "what is 234-67", expectedKind: "academic" },
  { label: "academic: explain a topic", message: "can you explain fractions to me", expectedKind: "academic" },
  { label: "academic: how-do-I question", message: "how do I add fractions", expectedKind: "academic" },
];

interface CaseResult {
  label: string;
  ok: boolean;
  detail: string;
  skippedAssertion?: boolean;
}

function checkResult(c: TestCase, actual: TutorIntent, strict: boolean): CaseResult {
  const mismatch = (why: string) => ({ label: c.label, ok: false, detail: why });

  if (actual.kind !== c.expectedKind) {
    if (c.heuristicMayMiss && !strict) {
      return { label: c.label, ok: true, skippedAssertion: true, detail: `kind=${actual.kind} (expected ${c.expectedKind}, but this case is flagged heuristicMayMiss)` };
    }
    return mismatch(`expected kind="${c.expectedKind}", got "${actual.kind}"`);
  }

  if (actual.kind === "fun_request") {
    if (c.expectedContentType && actual.contentType !== c.expectedContentType) {
      return mismatch(`expected contentType="${c.expectedContentType}", got "${actual.contentType}"`);
    }
    if (c.expectedSubject && actual.subject !== c.expectedSubject) {
      return mismatch(`expected subject="${c.expectedSubject}", got "${actual.subject}"`);
    }
  }

  if (actual.kind === "answer_attempt" && c.expectedCorrect !== undefined) {
    if (actual.correct !== c.expectedCorrect) {
      if (c.heuristicMayMiss && !strict) {
        return { label: c.label, ok: true, skippedAssertion: true, detail: `correct=${actual.correct} (expected ${c.expectedCorrect}, but this case is flagged heuristicMayMiss)` };
      }
      return mismatch(`expected correct=${c.expectedCorrect}, got ${actual.correct}`);
    }
  }

  return { label: c.label, ok: true, detail: JSON.stringify(actual) };
}

function printResults(sectionTitle: string, results: CaseResult[]) {
  console.log(`\n=== ${sectionTitle} ===`);
  let passed = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of results) {
    if (!r.ok) {
      failed++;
      console.log(`  FAIL  ${r.label}\n        ${r.detail}`);
    } else if (r.skippedAssertion) {
      skipped++;
      console.log(`  ~     ${r.label}  (known heuristic limitation - ${r.detail})`);
    } else {
      passed++;
      console.log(`  OK    ${r.label}`);
    }
  }
  console.log(`\n${sectionTitle}: ${passed} passed, ${skipped} known-limitation (not counted as failures), ${failed} FAILED, ${results.length} total`);
  return failed;
}

async function checkGeminiKeyStatus(): Promise<boolean> {
  try {
    const response = await getGeminiClient().models.generateContent({
      model: env.GEMINI_TUTOR_MODEL,
      contents: [{ text: "Reply with the single word: ok" }],
    });
    if (!response.text) throw new Error("empty response");
    console.log(`GEMINI KEY STATUS: OK (model ${env.GEMINI_TUTOR_MODEL} responded)`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`GEMINI KEY STATUS: NOT WORKING - ${message}`);
    console.log(
      "  The LIVE pass below will still run, but classifyTutorIntent's own fallback means every call " +
        "will silently re-run the heuristic under the hood - so a passing LIVE section here is NOT " +
        "evidence the real NLP prompt/schema works, only that the fallback wiring does. Fix the API key " +
        "in .env and re-run this script to get a real live-NLP verification."
    );
    return false;
  }
}

async function main() {
  const geminiWorking = await checkGeminiKeyStatus();

  // --- Pass 1: heuristic (offline, deterministic) ---
  const heuristicResults = CASES.map((c) => checkResult(c, heuristicClassifyTutorIntent(c.message, c.pending), false));
  const heuristicFailed = printResults("HEURISTIC (offline fallback) pass", heuristicResults);

  // --- Pass 2: live classifyTutorIntent (real Gemini call when the key works) ---
  const liveResults: CaseResult[] = [];
  for (const c of CASES) {
    const actual = await classifyTutorIntent(c.message, c.pending);
    liveResults.push(checkResult(c, actual, /* strict */ true));
  }
  const liveFailed = printResults(
    geminiWorking ? "LIVE (real Gemini NLP call) pass" : "LIVE pass (Gemini key not working - this is actually re-running the heuristic)",
    liveResults
  );

  console.log(`\n${"=".repeat(60)}`);
  if (heuristicFailed === 0 && liveFailed === 0) {
    console.log("ALL PASSED (see above for any known-heuristic-limitation notes)");
    process.exit(0);
  } else {
    console.log(`FAILED - ${heuristicFailed} heuristic failure(s), ${liveFailed} live failure(s)`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n=== test-tutor-intent.ts crashed ===");
  console.error(err);
  process.exit(1);
});
