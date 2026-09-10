import type { FastifyInstance } from "fastify";
import { eq, and, sql, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { subjects, questions, documents, gameAttempts } from "../db/schema.js";
import { starsForPercent } from "../lib/scoring.js";
import { getAppSettings, type AppSettings } from "../services/tutorBudget.js";

const DEFAULT_ROUND_SIZE = 10;

// The Arcade - see migration 0021 and "Practice games (the Arcade)" in
// plan/Question-Types-and-Content-Authoring-Plan.md. Deliberately reuses
// the exact same questions/answerPayload data model as the graded quiz -
// each game is just a (questionType, optional topic tag) filter over the
// same content, not a separate content system. `topic` is required for
// the three games whose mechanic only makes sense for specifically-tagged
// content (a match_column question could just as easily be a Maths
// times-table pairing as a word/definition pairing - the topic tag is
// what keeps "Word Meaning Match" from serving Maths content); the two
// spelling games have no topic filter since any missing_spelling question
// fits either presentation.
type QuestionTypeValue =
  | "mcq"
  | "true_false"
  | "fill_blank"
  | "missing_number"
  | "missing_spelling"
  | "match_column"
  | "short_answer"
  | "long_answer";

const GAME_DEFINITIONS: Record<string, { questionTypes: QuestionTypeValue[]; topic?: string }> = {
  spelling_sprint: { questionTypes: ["missing_spelling"] },
  missing_letters: { questionTypes: ["missing_spelling"] },
  word_meaning_match: { questionTypes: ["match_column"], topic: "Word Meanings" },
  homophone_hunter: { questionTypes: ["mcq", "fill_blank"], topic: "Homophones" },
  prefix_suffix_builder: { questionTypes: ["fill_blank"], topic: "Prefixes & Suffixes" },
};

// Flag-based feature management (migration 0023) - which app_settings
// column gates each individual game, checked together with the Arcade's
// own arcadeEnabled master switch below. Kept as its own small lookup
// (rather than baking the field name into GAME_DEFINITIONS) so the two
// concerns - "what content does this game need" vs. "is this game turned
// on" - stay separate, same reasoning question-shape.ts's extraction
// followed for validation logic.
const GAME_ENABLED_FIELD: Record<string, keyof AppSettings> = {
  spelling_sprint: "gameSpellingSprintEnabled",
  missing_letters: "gameMissingLettersEnabled",
  word_meaning_match: "gameWordMeaningMatchEnabled",
  homophone_hunter: "gameHomophoneHunterEnabled",
  prefix_suffix_builder: "gamePrefixSuffixBuilderEnabled",
};

function isGameEnabled(settings: AppSettings, gameKey: string): boolean {
  if (!settings.arcadeEnabled) return false;
  const field = GAME_ENABLED_FIELD[gameKey];
  return field ? Boolean(settings[field]) : true;
}

// Shared by GET /games/round and GET /games/available, so "does this game
// have any matching content" and "assemble a round for it" always agree
// on exactly what counts.
function conditionsFor(definition: { questionTypes: QuestionTypeValue[]; topic?: string }, subjectId: string | undefined, classId: string | undefined) {
  const conditions = [inArray(questions.questionType, definition.questionTypes)];
  if (subjectId) conditions.push(eq(questions.subjectId, subjectId));
  if (classId) conditions.push(eq(documents.classId, classId));
  if (definition.topic) conditions.push(sql`${questions.topics} @> ARRAY[${definition.topic}]::text[]`);
  return conditions;
}

// Fisher-Yates, same as quizzes.ts's shuffled() (duplicated rather than
// imported - it's not exported there, and this is the only other place
// that needs it).
function shuffled<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function gameRoutes(app: FastifyInstance) {
  // Assemble one round: a handful of questions matching the requested
  // game's (questionType, topic) shape, optionally narrowed further by
  // class/subject. Stateless - unlike /quizzes, no attempt row is created
  // here (a round isn't "resumable" the way a graded quiz is); the round
  // is only recorded once it's finished, via POST /games/attempts below.
  app.get<{
    Querystring: { game?: string; classId?: string; subjectName?: string; count?: string };
  }>("/games/round", async (request, reply) => {
    const gameKey = request.query.game;
    if (!gameKey || !(gameKey in GAME_DEFINITIONS)) {
      return reply.status(400).send({ error: `game must be one of: ${Object.keys(GAME_DEFINITIONS).join(", ")}` });
    }
    const settings = await getAppSettings();
    if (!isGameEnabled(settings, gameKey)) {
      return reply.status(403).send({ error: "This game isn't available right now. Ask a grown-up if you'd like to know more." });
    }

    const definition = GAME_DEFINITIONS[gameKey];
    const { classId, subjectName } = request.query;
    const count = Math.min(Math.max(1, Number(request.query.count) || DEFAULT_ROUND_SIZE), 30);

    let subjectId: string | undefined;
    if (subjectName) {
      const [subject] = await db.select().from(subjects).where(eq(subjects.name, subjectName)).limit(1);
      if (!subject) return reply.status(404).send({ error: `No subject named "${subjectName}"` });
      subjectId = subject.id;
    }

    const conditions = conditionsFor(definition, subjectId, classId);

    const picked = await db
      .select({
        id: questions.id,
        questionText: questions.questionText,
        options: questions.options,
        correctOptionId: questions.correctOptionId,
        questionType: questions.questionType,
        answerPayload: questions.answerPayload,
        imageUrl: questions.imageUrl,
      })
      .from(questions)
      .innerJoin(documents, eq(questions.documentId, documents.id))
      .where(and(...conditions))
      .orderBy(sql`random()`)
      .limit(count);

    if (picked.length === 0) {
      return reply.status(404).send({
        error: `No questions saved yet for the "${gameKey}" game matching those filters. Add some ${definition.questionTypes.join("/")} questions${definition.topic ? ` tagged "${definition.topic}"` : ""} in the admin dashboard first.`,
      });
    }

    // Deliberately NOT withholding correctOptionId/answerPayload the way
    // /quizzes does for the graded stage quiz (see assemblyAnswerPayload's
    // comment there). That rule exists because a quiz result is something
    // real - it clears a stage, earns stars toward progress, shows up in
    // reports - so a child reading the answer out of the network tab
    // before answering would be cheating something that matters. An
    // Arcade round is explicitly informal, repeatable practice with no
    // grading server-round-trip per question (that's what keeps it fast -
    // tap an answer, see instant right/wrong, immediately move on, same
    // feel as the reference Number Dash game) - the frontend grades each
    // answer itself, right there, the instant it's given. Nothing here is
    // "the test", so there's nothing to protect by hiding it.
    return reply.send({
      game: gameKey,
      questions: picked.map((q) => ({
        id: q.id,
        questionText: q.questionText,
        questionType: q.questionType,
        options: q.questionType === "mcq" || q.questionType === "true_false" ? shuffled(q.options) : q.options,
        correctOptionId: q.correctOptionId || null,
        answerPayload: q.answerPayload,
        imageUrl: q.imageUrl,
      })),
    });
  });

  // Which of the 5 games actually have at least one matching question for
  // this class+subject right now - drives the Arcade menu so it only ever
  // offers a game that will actually have content, the same "derive from
  // what's real, not a fixed list" convention /topics already uses (see
  // routes/classes.ts). Without this, e.g. the two spelling games would
  // show up as playable for Maths even though no missing_spelling content
  // is tagged there yet, only to 404 the moment a child tapped Play.
  app.get<{ Querystring: { classId?: string; subjectName?: string } }>("/games/available", async (request, reply) => {
    const { classId, subjectName } = request.query;

    let subjectId: string | undefined;
    if (subjectName) {
      const [subject] = await db.select().from(subjects).where(eq(subjects.name, subjectName)).limit(1);
      if (!subject) return reply.status(404).send({ error: `No subject named "${subjectName}"` });
      subjectId = subject.id;
    }

    const settings = await getAppSettings();

    const results = await Promise.all(
      Object.entries(GAME_DEFINITIONS).map(async ([key, definition]) => {
        // Flag-based feature management (migration 0023) - a disabled
        // game is skipped entirely, without even running its content
        // query, so it never appears in the Arcade menu (same effect as
        // "no content for this game yet", just admin-controlled instead
        // of content-driven).
        if (!isGameEnabled(settings, key)) return null;
        const [row] = await db
          .select({ id: questions.id })
          .from(questions)
          .innerJoin(documents, eq(questions.documentId, documents.id))
          .where(and(...conditionsFor(definition, subjectId, classId)))
          .limit(1);
        return row ? key : null;
      })
    );

    return reply.send({ games: results.filter((k): k is string => k !== null) });
  });

  // Record a finished round and award stars - the child (or the frontend,
  // right after the round ends) reports how many of the round it got
  // right; grading against the real correctOptionId/answerPayload happens
  // entirely client-side during play (the same way this round's own
  // sanitized payload was already stripped of answers above), since an
  // Arcade round has no per-question server round-trip the way the
  // graded quiz's /submit does - it's meant to feel instant.
  app.post<{
    Body: {
      profileId?: string;
      classId?: string;
      subjectId?: string;
      gameKey?: string;
      correctCount?: number;
      totalCount?: number;
    };
  }>("/games/attempts", async (request, reply) => {
    const { profileId, classId, subjectId, gameKey, correctCount, totalCount } = request.body ?? {};

    if (!gameKey || !(gameKey in GAME_DEFINITIONS)) {
      return reply.status(400).send({ error: `gameKey must be one of: ${Object.keys(GAME_DEFINITIONS).join(", ")}` });
    }
    if (
      typeof totalCount !== "number" ||
      typeof correctCount !== "number" ||
      totalCount <= 0 ||
      correctCount < 0 ||
      correctCount > totalCount ||
      !Number.isInteger(totalCount) ||
      !Number.isInteger(correctCount)
    ) {
      return reply.status(400).send({ error: "correctCount and totalCount must be integers, with 0 <= correctCount <= totalCount and totalCount > 0" });
    }

    const stars = starsForPercent(correctCount / totalCount);

    const [attempt] = await db
      .insert(gameAttempts)
      .values({
        profileId: profileId ?? undefined,
        classId: classId ?? undefined,
        subjectId: subjectId ?? undefined,
        gameKey,
        correctCount,
        totalCount,
        starsEarned: stars,
      })
      .returning();

    return reply.status(201).send({ attemptId: attempt.id, starsEarned: stars });
  });
}
