import { and, eq, notInArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { documents, questions } from "../db/schema.js";

// The curriculum counterpart to funContent.ts's riddles/jokes/puzzles -
// see the user's own framing for this feature (9 September 2026): "just
// like 22 + 33 gets computed instantly, ask real maths questions from the
// actual question paper, check the typed answer - this is a different
// kind of quiz, interactive games, children will love it." Deliberately
// Gemini-free (matching tutorArithmetic.ts's own constraint - doubly
// important right now with GEMINI_API_KEY unavailable for the next few
// days): picking a question is a plain random SQL query, and checking the
// answer is local string matching against the question's own
// correctOptionId, never an LLM judgement call. Scoped to whichever
// class/subject the CURRENT conversation is already tied to
// (tutor_conversations.classId/subjectId, migration 0009) - confirmed
// with the user as the right scope ("based on which class and subject...
// for ask to study buddy"), rather than adding a second, separate
// subject-picker inside chat. Deliberately a SEPARATE, low-stakes
// practice mode: none of this ever touches quiz_attempts/quizAttempts,
// so playing it has no effect on real stars, quest-map progress, or the
// leaderboard - see tutor.ts's own note on why answer_attempt handling
// branches on pending.kind rather than writing through the real scoring
// engine.

export interface QuizGameQuestion {
  id: string;
  questionText: string;
  options: { id: string; text: string }[];
  correctOptionId: string;
  explanation: string;
  tip: string | null;
}

const SELECT_COLUMNS = {
  id: questions.id,
  questionText: questions.questionText,
  options: questions.options,
  correctOptionId: questions.correctOptionId,
  explanation: questions.explanation,
  tip: questions.tip,
} as const;

/**
 * Picks one real question for the child to practice, scoped to the given
 * class+subject (same questions-joined-with-documents scoping as POST
 * /quizzes' own assembly query in quizzes.ts - class lives on `documents`,
 * not directly on `questions`). Prefers a question not already asked in
 * THIS conversation (excludeIds - tutor.ts passes every questionId
 * already served as 'quiz_question' so far this chat) so one sitting
 * doesn't repeat itself; once every question in scope has been used
 * (or excludeIds is empty because this is the first one), falls back to
 * the full pool - `exhausted: true` on that fallback lets tutor.ts phrase
 * a friendly "you've done them all, let's go again!" instead of silently
 * repeating. Returns null only if this class+subject genuinely has no
 * questions saved at all yet.
 */
export async function pickQuizQuestion(params: {
  classId: string;
  subjectId: string;
  excludeIds: string[];
}): Promise<{ question: QuizGameQuestion; exhausted: boolean } | null> {
  const { classId, subjectId, excludeIds } = params;
  const baseConditions = [eq(questions.subjectId, subjectId), eq(documents.classId, classId)];

  async function pickOne(conditions: typeof baseConditions) {
    const [row] = await db
      .select(SELECT_COLUMNS)
      .from(questions)
      .innerJoin(documents, eq(questions.documentId, documents.id))
      .where(and(...conditions))
      .orderBy(sql`random()`)
      .limit(1);
    return row ?? null;
  }

  if (excludeIds.length > 0) {
    const unseen = await pickOne([...baseConditions, notInArray(questions.id, excludeIds)]);
    if (unseen) return { question: unseen, exhausted: false };
  }

  const anyQuestion = await pickOne(baseConditions);
  if (!anyQuestion) return null;
  return { question: anyQuestion, exhausted: excludeIds.length > 0 };
}

/** Looks up one question by id - used to resolve a pending/most-recent
 * quiz-game question the same way funContent.ts's getFunContentById
 * resolves a pending riddle/joke/puzzle (see tutor.ts's
 * getPendingInteractive/findMostRecentInteractiveItem). */
export async function getQuizQuestionById(id: string): Promise<QuizGameQuestion | null> {
  const [row] = await db.select(SELECT_COLUMNS).from(questions).where(eq(questions.id, id)).limit(1);
  return row ?? null;
}

const OPTION_LETTERS = "ABCDEFGH";

// Display letters are computed by array position, NOT read off
// option.id - matching Quiz.tsx's own LETTERS[i] convention exactly,
// since option ids aren't guaranteed to be "a"/"b"/"c"/"d" (they're
// whatever the admin/content-generation flow assigned). Keeping this the
// same convention as the real Quiz screen means a child who's played
// both never sees the lettering disagree between them.
function letterFor(index: number): string {
  return OPTION_LETTERS[index] ?? String(index + 1);
}

function formatOptionsBlock(options: { id: string; text: string }[]): string {
  return options.map((opt, i) => `${letterFor(i)}) ${opt.text}`).join("\n");
}

/**
 * Formats a served question as a chat-ready reply, options included -
 * unlike formatFunContentReply (which withholds a riddle's answer text
 * but still just asks an open question), a real curriculum question is
 * multiple-choice by nature, so the options are always shown up front.
 * The child can answer with either the letter or the option's own text
 * (see checkQuizAnswer below) - deliberately not forcing one input style,
 * since a child comfortable just typing the actual answer shouldn't have
 * to translate it into "B" first, and one who prefers picking a letter
 * shouldn't have to retype the whole option text either.
 */
export function formatQuizQuestionReply(question: QuizGameQuestion, opts?: { exhausted?: boolean }): string {
  const intro = opts?.exhausted
    ? "🎓 You've done every practice question I have for this one - amazing work! Let's go again:"
    : "🎓 Practice time! Here's a real question from your own lessons:";
  return `${intro}\n\n${question.questionText}\n\n${formatOptionsBlock(question.options)}\n\nType your answer - the letter or the answer itself both work!`;
}

/** Reveals the correct option AND the question's own explanation, once
 * the child asks for it or after a wrong guess accepts the offer - unlike
 * formatFunContentAnswer's bare "the answer is...", a real lesson
 * question's explanation is real teaching content worth always including,
 * matching what Quiz/Results already show on a wrong answer. */
export function formatQuizAnswerReveal(question: QuizGameQuestion): string {
  const correctIndex = question.options.findIndex((o) => o.id === question.correctOptionId);
  const correctOption = question.options[correctIndex];
  const letterPart = correctOption ? `${letterFor(correctIndex)}) ${correctOption.text}` : "(answer unavailable)";
  return `The answer is ${letterPart}.\n\n${question.explanation}`;
}

/** Formats a hint from the question's own `tip` field (a memorable trick/
 * strategy, distinct from `explanation` - see schema.ts's own doc comment
 * on questions.tip) - the same "surfaced especially on a wrong answer"
 * content the Quiz/Results screens already use, not a new hint bank.
 * Degrades the same way formatFunContentHint does for an item with
 * nothing saved yet. */
export function formatQuizHint(question: QuizGameQuestion): string {
  if (!question.tip) {
    return "I don't have a hint saved for this one yet - want me to just tell you the answer instead?";
  }
  return `Here's a hint: ${question.tip}`;
}

// Normalizes user text for matching - same spirit as tutorIntent.ts's own
// normalizeForFuzzyMatch, kept as its own copy rather than shared/
// imported, since this module deliberately has zero dependency on
// tutorIntent.ts and needs to keep working exactly as-is even if that
// file's own matching logic ever changes.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/^(the answer is|its?|it is|is it|maybe|i think( its?)?|my guess is|answer\s*:?|option)\s+/i, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deterministic, Gemini-free correctness check for a real curriculum
 * question - unlike a riddle's fuzzy "close enough" wording match
 * (tutorIntent.ts's looksLikeCorrectGuess), a question here has one
 * objectively right option, so this is checked directly against it
 * rather than left to an LLM's generous judgement call (see tutor.ts's
 * own note on why the quiz-game path always overrides
 * classifyTutorIntent's `correct` field for this exact reason - and why
 * that matters doubly while GEMINI_API_KEY is down). Accepts either the
 * option's display letter (matching how it was shown - "b", "option b",
 * "(B)" all work) or the option's own text, loosely matched the same way
 * looksLikeCorrectGuess is (exact, or one contains the other).
 */
export function checkQuizAnswer(guessRaw: string, question: QuizGameQuestion): boolean {
  const correctIndex = question.options.findIndex((o) => o.id === question.correctOptionId);
  if (correctIndex === -1) return false;
  const correctLetter = letterFor(correctIndex).toLowerCase();
  const correctText = normalize(question.options[correctIndex].text);

  const guess = normalize(guessRaw);
  if (guess.length === 0) return false;

  // A bare or near-bare letter match ("b", "b)", "option b" - "option "
  // is stripped by normalize() above) - only trusted when short enough
  // that it's plausibly JUST a letter, not a longer answer that happens
  // to contain that letter.
  const guessLettersOnly = guess.replace(/[^a-z]/g, "");
  if (guess.length <= 3 && guessLettersOnly === correctLetter) return true;

  if (correctText.length >= 2 && (guess === correctText || guess.includes(correctText) || correctText.includes(guess))) {
    return true;
  }
  return false;
}
