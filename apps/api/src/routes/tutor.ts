import type { FastifyInstance } from "fastify";
import { eq, and, desc, gte, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { classes, subjects, tutorConversations, tutorMessages } from "../db/schema.js";
import { requireIdentity } from "../auth.js";
import {
  isTutorEnabled,
  checkDailyCap,
  recordTutorExchange,
  recordSimpleTutorExchange,
  getAppSettings,
  getCachedReply,
} from "../services/tutorBudget.js";
import { retrieveForQuery, retrieveForQuestion } from "../services/tutorRetrieval.js";
import { generateTutorReply } from "../services/tutorGeneration.js";
import { classifyTutorIntent } from "../services/tutorIntent.js";
import { tryEvaluateArithmetic } from "../services/tutorArithmetic.js";
import {
  getRandomFunContent,
  getFunContentById,
  formatFunContentReply,
  formatFunContentAnswer,
  formatFunContentHint,
  type FunContentItem,
} from "../services/funContent.js";
import {
  pickQuizQuestion,
  getQuizQuestionById,
  formatQuizQuestionReply,
  formatQuizAnswerReveal,
  formatQuizHint,
  checkQuizAnswer,
  type QuizGameQuestion,
} from "../services/tutorQuizGame.js";
import { buildGreeting } from "../services/tutorProgress.js";

// The AI Study Mentor's actual routes - see plan/AI-Study-Mentor-Agent-Plan.md,
// Section 9 and Section 10 step 6. Every real decision (what counts as a
// match, how a reply gets generated, whether a profile's hit its daily
// cap) already lives in tutorRetrieval.ts/tutorGeneration.ts/tutorBudget.ts;
// this file's whole job is wiring those three together in the right order
// and enforcing who can see what, the same "profile sees only its own,
// admin can see anyone's" pattern reports.ts already established.

// Friendly, child-facing replies for the two ways a message can be
// blocked before ever reaching retrieval or generation - deliberately
// distinct from tutorGeneration.ts's TEMPLATE_FALLBACK_REPLY, which means
// something different ("I looked, and this isn't something I know about")
// versus these ("you can't ask me anything right now, for an unrelated
// reason"). Conflating the two would make a capped-out day look
// indistinguishable from an honest "out of scope" answer, which isn't true.
const DAILY_CAP_REPLY =
  "You've used up your Study Buddy chats for today! Come back tomorrow and I'll be ready to help again.";
const TUTOR_DISABLED_REPLY = "Study Buddy isn't available right now. Ask a grown-up if you'd like to know more.";

// Mid-conversation greeting/thanks replies - deliberately NOT a Gemini
// call (unlike the once-per-conversation opening greeting in
// buildGreeting), since these are cheap, low-stakes social turns that
// don't need to be grounded in anything - a short pool kept so it
// doesn't feel like the exact same canned line every time. See
// tutorIntent.ts for how a message is classified as one of these.
const GREETING_REPLIES = [
  "Hi again! What would you like to do next - a question about your lessons, or something fun?",
  "Hello! Good to see you back. Ask me anything, or say the word if you'd rather play.",
  "Hey there! I'm ready whenever you are - lessons or a bit of fun, your choice.",
];
const THANKS_REPLIES = [
  "You're welcome! Keep up the great work.",
  "Anytime! I'm really proud of how hard you're trying.",
  "No problem at all - that's what I'm here for!",
];
const CORRECT_GUESS_REPLIES = [
  "That's it - you got it! Nicely done!",
  "Yes! You figured it out!",
  "Correct! You're a riddle master!",
];
const INCORRECT_GUESS_REPLIES = [
  "Not quite! Want a hint, or should I tell you the answer?",
  "Good try, but that's not it! Try again, or ask me to reveal the answer.",
  "Close, but not quite - want to guess again, or see the answer?",
];

// The quiz-game's own counterpart to the two arrays above - kept
// separate (rather than reused) so a real practice question gets replies
// that read as "you're learning your actual lessons" rather than "you're
// a riddle master", matching formatQuizAnswerReveal/formatQuizHint's own
// tone (tutorQuizGame.ts).
const QUIZ_CORRECT_REPLIES = [
  "That's correct! Great work!",
  "Yes, exactly right!",
  "Correct! You really know this one!",
];
const QUIZ_INCORRECT_REPLIES = [
  "Not quite! Want a hint, or should I tell you the answer?",
  "Good try, but that's not it! Want a hint, or should I show you the answer?",
  "Close, but not quite right - want a hint, or to see the answer?",
];

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// A pending "something to guess" state, generalized 9 September 2026 to
// cover TWO different content sources sharing one mechanism: a riddle/
// joke/puzzle/trivia item from fun_content (the original design), or a
// real curriculum question from the quiz game (tutorQuizGame.ts, added
// for the "ask real questions from my lessons" feature). Only one can
// ever be pending at once - the very last message in a conversation has
// exactly one matchedSourceType - so this is a discriminated union on
// `kind`, not two independent booleans.
type PendingInteractive =
  | { kind: "fun_content"; item: FunContentItem; offeredReveal: boolean }
  | { kind: "quiz_question"; item: QuizGameQuestion; offeredReveal: boolean };

// Was a riddle/joke/puzzle/trivia question, a real practice question, or
// this app's own offer to reveal one after a wrong guess - the very last
// thing said in this conversation? If so, the child's next message is
// very likely about that question (see tutorIntent.ts's answer_attempt/
// reveal_answer intents and the context-aware classification they do),
// not a fresh request or lesson question. Deliberately strict about "the
// very last message" - once anything else has happened since (a reveal,
// a correct guess, a new item, an academic reply), the window closes and
// the next message is classified fresh instead of being forced against a
// stale question. Returns null (nothing pending) when a fun_content item
// has no answerText at all (e.g. a tongue twister) - there's nothing to
// guess or reveal.
//
// `offeredReveal` on the return value distinguishes the two states: false
// means the original question was just asked (a plain guess is expected
// next); true means the child already guessed wrong once and was just
// asked "want a hint, or should I tell you the answer?" (see tutor.ts's
// INCORRECT_GUESS_REPLIES/QUIZ_INCORRECT_REPLIES below) - a short
// "yes"/"sure" next should be read as accepting that offer, not as
// another blind guess.
async function getPendingInteractive(conversationId: string): Promise<PendingInteractive | null> {
  const [lastMessage] = await db
    .select({
      role: tutorMessages.role,
      sourceType: tutorMessages.matchedSourceType,
      sourceId: tutorMessages.matchedSourceId,
    })
    .from(tutorMessages)
    .where(eq(tutorMessages.conversationId, conversationId))
    .orderBy(desc(tutorMessages.createdAt))
    .limit(1);
  if (!lastMessage || lastMessage.role !== "agent" || !lastMessage.sourceId) return null;

  if (lastMessage.sourceType === "fun_content" || lastMessage.sourceType === "reveal_offer") {
    const item = await getFunContentById(lastMessage.sourceId);
    if (!item || !item.answerText) return null;
    return { kind: "fun_content", item, offeredReveal: lastMessage.sourceType === "reveal_offer" };
  }
  if (lastMessage.sourceType === "quiz_question" || lastMessage.sourceType === "quiz_reveal_offer") {
    const item = await getQuizQuestionById(lastMessage.sourceId);
    if (!item) return null;
    return { kind: "quiz_question", item, offeredReveal: lastMessage.sourceType === "quiz_reveal_offer" };
  }
  return null;
}

// Which riddle/joke/puzzle/trivia item OR real practice question is the
// child asking about when they say "what's the answer" or "give me a
// hint"? Deliberately more lenient than getPendingInteractive above:
// this searches the WHOLE conversation history for the most recent
// fun_content or quiz_question item actually served, not just the very
// last message - a reveal or hint request still needs to resolve
// correctly even after other turns (an incorrect guess's own feedback, a
// previous hint) have happened since the question was first asked.
// Returns null if nothing has been served yet in this conversation.
async function findMostRecentInteractiveItem(conversationId: string): Promise<PendingInteractive | null> {
  const [lastItemMessage] = await db
    .select({ sourceType: tutorMessages.matchedSourceType, sourceId: tutorMessages.matchedSourceId })
    .from(tutorMessages)
    .where(
      and(
        eq(tutorMessages.conversationId, conversationId),
        inArray(tutorMessages.matchedSourceType, ["fun_content", "quiz_question"])
      )
    )
    .orderBy(desc(tutorMessages.createdAt))
    .limit(1);
  if (!lastItemMessage?.sourceId) return null;
  if (lastItemMessage.sourceType === "fun_content") {
    const item = await getFunContentById(lastItemMessage.sourceId);
    return item ? { kind: "fun_content", item, offeredReveal: false } : null;
  }
  const item = await getQuizQuestionById(lastItemMessage.sourceId);
  return item ? { kind: "quiz_question", item, offeredReveal: false } : null;
}

// Every real question already served as 'quiz_question' so far in this
// conversation - passed to pickQuizQuestion as excludeIds so one sitting
// doesn't repeat the same question over and over (tutorQuizGame.ts's own
// doc comment on why an exhausted pool still falls back to a repeat
// rather than a dead end).
async function getAskedQuizQuestionIds(conversationId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ sourceId: tutorMessages.matchedSourceId })
    .from(tutorMessages)
    .where(and(eq(tutorMessages.conversationId, conversationId), eq(tutorMessages.matchedSourceType, "quiz_question")));
  return rows.map((r) => r.sourceId).filter((id): id is string => Boolean(id));
}

export async function tutorRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireIdentity);

  // Start or resume a conversation. Only a profile session can start one -
  // this is the child's own chat, not something an admin session
  // initiates on their behalf. "Resume" is deliberately simple for this
  // first version: a 'question' conversation resumes the existing thread
  // for the same profile+question if one exists, so re-tapping "explain
  // this to me" on the same wrong answer continues one conversation
  // rather than forking a new one every tap; a 'general' conversation
  // resumes today's thread for this profile+class+subject if one exists,
  // otherwise starts a new one - "one general chat per class/subject per
  // day", not a single eternal thread or a full thread-picker UI, since
  // neither was asked for yet and this is easy to revisit later without
  // a schema change.
  app.post<{
    Body: {
      classId?: string;
      subjectId?: string;
      contextType?: "general" | "question";
      questionId?: string;
      attemptId?: string;
    };
  }>("/tutor/conversations", async (request, reply) => {
    const identity = request.identity!;
    if (identity.kind !== "profile") {
      return reply.status(403).send({ error: "Only a profile session can start a Study Buddy conversation." });
    }

    const { classId, subjectId, questionId, attemptId } = request.body ?? {};
    const contextType = request.body?.contextType ?? "general";
    if (!classId || !subjectId) {
      return reply.status(400).send({ error: "classId and subjectId are required." });
    }
    if (contextType === "question" && !questionId) {
      return reply.status(400).send({ error: "questionId is required for a 'question' conversation." });
    }

    if (contextType === "question") {
      const [existing] = await db
        .select()
        .from(tutorConversations)
        .where(
          and(
            eq(tutorConversations.profileId, identity.profileId),
            eq(tutorConversations.contextType, "question"),
            eq(tutorConversations.relatedQuestionId, questionId!)
          )
        )
        .limit(1);
      if (existing) return reply.send(existing);
    } else {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      const [existing] = await db
        .select()
        .from(tutorConversations)
        .where(
          and(
            eq(tutorConversations.profileId, identity.profileId),
            eq(tutorConversations.contextType, "general"),
            eq(tutorConversations.classId, classId),
            eq(tutorConversations.subjectId, subjectId),
            gte(tutorConversations.startedAt, todayStart)
          )
        )
        .orderBy(desc(tutorConversations.startedAt))
        .limit(1);
      if (existing) return reply.send(existing);
    }

    const [created] = await db
      .insert(tutorConversations)
      .values({
        profileId: identity.profileId,
        classId,
        subjectId,
        contextType,
        relatedQuestionId: contextType === "question" ? questionId : undefined,
        relatedAttemptId: contextType === "question" ? attemptId : undefined,
      })
      .returning();

    // A proactive, real-progress-aware hello - see tutorProgress.ts. Only
    // ever generated here, on a genuinely NEW conversation (both resume
    // branches above return early before reaching this point), so it
    // shows up exactly once in the transcript, not on every resume/reload.
    // Stored as an 'agent' row with no matching 'student' turn, and also
    // returned inline so the frontend can render it immediately without a
    // second round trip.
    const greeting = await buildGreeting({ profileId: identity.profileId, profileName: identity.name });
    await recordSimpleTutorExchange({ conversationId: created.id, replyText: greeting, sourceType: "social" });

    return reply.status(201).send({ ...created, greeting });
  });

  // The actual chat turn: on/off toggle -> arithmetic -> intent
  // classification -> (daily cap ->) retrieval -> generation -> record,
  // each step short-circuiting the next when it doesn't need to run.
  // Updated 9 September 2026, confirmed with the user: fun content,
  // arithmetic, and intent classification's own keyword fallback all work
  // without Gemini, and none of them should ever be blocked by either the
  // admin off-switch's cousin (the daily cap, which is purely a cost
  // control on real Gemini calls - see tutorBudget.ts) or by which kind of
  // conversation this is. So checkDailyCap only runs right before the
  // retrieval -> generation pipeline below, once a message has actually
  // been classified as academic - not up front for the whole route - and
  // intent classification itself now runs for EVERY conversation, not
  // just "general" ones, so a 'question' ("explain this quiz answer")
  // chat can still ask for a joke or a sum mid-conversation. Only
  // isTutorEnabled() (the admin's full kill-switch) still gates
  // everything up front, since that's meant to block the whole feature,
  // not just its Gemini-dependent half.
  app.post<{ Params: { id: string }; Body: { message?: string } }>(
    "/tutor/conversations/:id/messages",
    async (request, reply) => {
      const identity = request.identity!;
      const message = request.body?.message?.trim();
      if (!message) return reply.status(400).send({ error: "message is required." });

      const [conversation] = await db
        .select()
        .from(tutorConversations)
        .where(eq(tutorConversations.id, request.params.id))
        .limit(1);
      if (!conversation) return reply.status(404).send({ error: "Conversation not found." });
      // 404, not 403, for a profile session hitting someone else's
      // conversation id - it shouldn't be able to tell the difference
      // between "not yours" and "doesn't exist". An admin session has no
      // such restriction, same override principle as /reports.
      if (identity.kind === "profile" && conversation.profileId !== identity.profileId) {
        return reply.status(404).send({ error: "Conversation not found." });
      }

      if (!(await isTutorEnabled())) {
        return reply.send({ mode: "blocked", reason: "tutor_disabled", reply: TUTOR_DISABLED_REPLY });
      }

      // A bare arithmetic expression ("25 + 20", "5*8", "1/4 + 2/4") is
      // computed locally and instantly - see tutorArithmetic.ts's own doc
      // comment for exactly what counts as "bare" (deliberately narrow,
      // so a real word problem or "how do I add 3-digit numbers" still
      // falls through to a real explanation below instead of just a
      // number). Checked before intent classification and unconditionally
      // for every conversation, same reasoning as fun content: this never
      // touches Gemini, so it should never depend on it being up, and
      // never counts against the daily cap.
      const arithmetic = tryEvaluateArithmetic(message);
      if (arithmetic) {
        const replyText = `🧮 ${arithmetic.expression} = ${arithmetic.resultText}`;
        await recordSimpleTutorExchange({
          conversationId: conversation.id,
          studentMessage: message,
          replyText,
          sourceType: "social",
        });
        return reply.send({ mode: "template", reply: replyText });
      }

      // Intent classification now runs for every conversation, not just
      // "general" ones - a 'question' ("explain this quiz answer") chat
      // used to skip this entirely, on the reasoning that its whole point
      // is one specific wrong answer and there was no ambiguity to
      // resolve. Confirmed with the user 9 September 2026 that Study
      // Buddy should "manage all kinds of questions" regardless of which
      // conversation it's in - a child asking for a joke or a hint
      // mid-explanation should get one, not the academic honest-fallback
      // reply. See tutorIntent.ts.
      {
        const pending = await getPendingInteractive(conversation.id);
        // classifyTutorIntent only needs a generic {promptText,
        // answerText, offeredReveal} shape to judge reveal/hint/guess
        // intent - it doesn't need to know or care which of the two
        // sources (fun_content vs a real quiz question) is pending. The
        // ACTUAL correctness of a quiz-question guess is never trusted
        // from here though - see the answer_attempt handling below,
        // which always re-checks a quiz question deterministically via
        // checkQuizAnswer instead of intent.correct.
        const pendingContext =
          pending &&
          (pending.kind === "fun_content"
            ? { promptText: pending.item.promptText, answerText: pending.item.answerText!, offeredReveal: pending.offeredReveal }
            : {
                promptText: pending.item.questionText,
                answerText: pending.item.options.find((o) => o.id === pending.item.correctOptionId)?.text ?? "",
                offeredReveal: pending.offeredReveal,
              });
        const intent = await classifyTutorIntent(message, pendingContext || undefined);

        if (intent.kind === "greeting" || intent.kind === "thanks") {
          const replyText = pickRandom(intent.kind === "greeting" ? GREETING_REPLIES : THANKS_REPLIES);
          await recordSimpleTutorExchange({
            conversationId: conversation.id,
            studentMessage: message,
            replyText,
            sourceType: "social",
          });
          return reply.send({ mode: "template", reply: replyText });
        }

        if (intent.kind === "fun_request") {
          // Flag-based feature management (migration 0023) - checked
          // here rather than up front with isTutorEnabled(), since this
          // toggle only turns off the playful riddle/joke/tongue-twister/
          // trivia bank, not the rest of Study Buddy (real academic help
          // stays on even with this off).
          const settings = await getAppSettings();
          if (!settings.tutorFunContentEnabled) {
            const replyText = "Riddles and jokes are turned off right now - ask a grown-up if you'd like them back on!";
            await recordSimpleTutorExchange({
              conversationId: conversation.id,
              studentMessage: message,
              replyText,
              sourceType: "social",
            });
            return reply.send({ mode: "template", reply: replyText });
          }

          const item = await getRandomFunContent({ contentType: intent.contentType, subject: intent.subject });
          const replyText = item
            ? formatFunContentReply(item)
            : "I don't have any of those saved up yet - ask a grown-up to add some to Puzzle Kingdom!";
          await recordSimpleTutorExchange({
            conversationId: conversation.id,
            studentMessage: message,
            replyText,
            sourceType: item ? "fun_content" : "social",
            sourceId: item?.id,
          });
          return reply.send({ mode: "template", reply: replyText });
        }

        // The real-question chat quiz game (tutorQuizGame.ts) - picks one
        // real question scoped to THIS conversation's own classId/
        // subjectId (confirmed with the user as the right scope, rather
        // than a new subject-picker inside chat), entirely Gemini-free.
        // Deliberately a separate practice mode: nothing here ever writes
        // to quiz_attempts, so playing it has no effect on real stars,
        // quest-map progress, or the leaderboard - answering is purely
        // for fun/practice, same spirit as a riddle.
        if (intent.kind === "quiz_game_request") {
          const askedIds = await getAskedQuizQuestionIds(conversation.id);
          const picked = await pickQuizQuestion({
            classId: conversation.classId,
            subjectId: conversation.subjectId,
            excludeIds: askedIds,
          });
          const replyText = picked
            ? formatQuizQuestionReply(picked.question, { exhausted: picked.exhausted })
            : "I don't have any practice questions saved yet for this class and subject - ask a grown-up to add some to Puzzle Kingdom!";
          await recordSimpleTutorExchange({
            conversationId: conversation.id,
            studentMessage: message,
            replyText,
            sourceType: picked ? "quiz_question" : "social",
            sourceId: picked?.question.id,
          });
          return reply.send({ mode: "template", reply: replyText });
        }

        if (intent.kind === "reveal_answer") {
          // formatFunContentReply/formatQuizQuestionReply both
          // deliberately withhold the answer up front, so "what's the
          // answer"/"I give up" needs to look back at whichever item was
          // sent last to know which answer to give -
          // findMostRecentInteractiveItem below does that lookup across
          // both sources.
          const item = await findMostRecentInteractiveItem(conversation.id);
          const replyText = !item
            ? "I haven't asked you a riddle, joke, puzzle, or practice question yet this chat - want one? Just ask!"
            : item.kind === "fun_content"
              ? formatFunContentAnswer(item.item)
              : formatQuizAnswerReveal(item.item);
          await recordSimpleTutorExchange({
            conversationId: conversation.id,
            studentMessage: message,
            replyText,
            // Always 'social', never 'fun_content'/'quiz_question' -
            // revealing an answer closes the pending-question window
            // (getPendingInteractive above only looks at the very last
            // message), so the child's next message is classified fresh
            // rather than re-checked as another guess at a question
            // they've already been told.
            sourceType: "social",
          });
          return reply.send({ mode: "template", reply: replyText });
        }

        if (intent.kind === "hint_request") {
          // Same lookup as reveal_answer above - a hint is about the same
          // "which question are they asking about" question, it just gets
          // formatted as a nudge instead of the full answer (see
          // formatFunContentHint/formatQuizHint's own doc comments for
          // why these are kept separate replies rather than collapsing
          // hint_request into reveal_answer).
          const item = await findMostRecentInteractiveItem(conversation.id);
          const replyText = !item
            ? "I haven't asked you a riddle, joke, puzzle, or practice question yet this chat - want one? Just ask!"
            : item.kind === "fun_content"
              ? formatFunContentHint(item.item)
              : formatQuizHint(item.item);
          await recordSimpleTutorExchange({
            conversationId: conversation.id,
            studentMessage: message,
            replyText,
            // Unlike reveal_answer, a hint should NOT close the pending
            // window - the child is still expected to guess again, so
            // this reopens (or keeps open) the same pending state as the
            // original question (offeredReveal: false, since a hint
            // isn't the "want a hint, or the answer?" offer itself).
            // Falls back to 'social' when there was nothing to hint at in
            // the first place.
            sourceType: !item ? "social" : item.kind === "fun_content" ? "fun_content" : "quiz_question",
            sourceId: item?.item.id,
          });
          return reply.send({ mode: "template", reply: replyText });
        }

        if (intent.kind === "answer_attempt") {
          // pending is guaranteed set here - classifyTutorIntent only
          // ever returns answer_attempt when it was given pending context
          // to judge against in the first place (see tutorIntent.ts).
          if (pending!.kind === "quiz_question") {
            // A real curriculum question has one objectively right
            // answer, so this is checked deterministically via
            // checkQuizAnswer (tutorQuizGame.ts) - intent.correct (an
            // LLM's generous, wording-tolerant judgement, exactly right
            // for a riddle's fuzzy phrasing) is never trusted here. This
            // matters doubly with GEMINI_API_KEY currently unavailable:
            // this whole path stays correct and Gemini-free either way.
            const correct = checkQuizAnswer(message, pending!.item);
            const base = pickRandom(correct ? QUIZ_CORRECT_REPLIES : QUIZ_INCORRECT_REPLIES);
            // On a correct guess, reinforce the learning with the
            // question's own explanation - the same content Results
            // already shows, not just a bare "correct!".
            const replyText = correct ? `${base}\n\n${pending!.item.explanation}` : base;
            await recordSimpleTutorExchange({
              conversationId: conversation.id,
              studentMessage: message,
              replyText,
              sourceType: correct ? "social" : "quiz_reveal_offer",
              sourceId: correct ? undefined : pending!.item.id,
            });
            return reply.send({ mode: "template", reply: replyText });
          }

          const replyText = pickRandom(intent.correct ? CORRECT_GUESS_REPLIES : INCORRECT_GUESS_REPLIES);
          await recordSimpleTutorExchange({
            conversationId: conversation.id,
            studentMessage: message,
            replyText,
            // A correct guess closes the window entirely - 'social',
            // nothing left to guess or reveal. An incorrect guess instead
            // reopens it as 'reveal_offer': INCORRECT_GUESS_REPLIES just
            // asked "want a hint, or should I tell you the answer?", so
            // getPendingInteractive above needs to recognize a short
            // "yes" next turn as accepting that offer (tutorIntent.ts's
            // offeredReveal handling) rather than as a fresh guess.
            sourceType: intent.correct ? "social" : "reveal_offer",
            sourceId: intent.correct ? undefined : pending!.item.id,
          });
          return reply.send({ mode: "template", reply: replyText });
        }
        // intent.kind === "academic" falls through to the existing
        // retrieval -> generation pipeline below, unchanged.
      }

      // Track 2's three-way Resource Access toggle (migration 0022,
      // ported from ~/Work/AI-ML/Custom Gemini's use_concept_guides/
      // use_cache/use_gemini session toggles) - read once and threaded
      // through the cache check, retrieval, and generation below.
      const settings = await getAppSettings();

      // The "Cache" toggle - reuse a previous real Gemini answer to this
      // same scoped question before spending any quota at all, so this
      // deliberately runs BEFORE checkDailyCap, same as the reference
      // prototype's cache-before-Gemini ordering. See tutorBudget.ts's
      // getCachedReply doc comment for exactly what counts as a hit.
      if (settings.tutorUseCache) {
        const cached = await getCachedReply({
          profileId: conversation.profileId,
          classId: conversation.classId,
          subjectId: conversation.subjectId,
          queryText: message,
        });
        if (cached) {
          await recordSimpleTutorExchange({
            conversationId: conversation.id,
            studentMessage: message,
            replyText: cached,
            sourceType: "cached",
          });
          return reply.send({ mode: "cached", reply: cached });
        }
      }

      // Only now, once a message has actually been classified as
      // academic (the one path that can call Gemini for a real answer),
      // does the cost-focused daily cap apply - see tutorBudget.ts's
      // checkDailyCap doc comment for the full reasoning on why this
      // moved from an upfront check to here.
      const dailyCap = await checkDailyCap(conversation.profileId);
      if (!dailyCap.allowed) {
        return reply.send({ mode: "blocked", reason: "daily_cap_reached", reply: DAILY_CAP_REPLY });
      }

      const retrieval =
        conversation.contextType === "question"
          ? await retrieveForQuestion({
              questionId: conversation.relatedQuestionId!,
              classId: conversation.classId,
              subjectId: conversation.subjectId,
              useConceptGuides: settings.tutorUseConceptGuides,
            })
          : await retrieveForQuery({
              queryText: message,
              classId: conversation.classId,
              subjectId: conversation.subjectId,
              useConceptGuides: settings.tutorUseConceptGuides,
            });

      const tutorReply = await generateTutorReply({
        queryText: message,
        retrieval,
        useGemini: settings.tutorUseGemini,
      });

      await recordTutorExchange({
        conversationId: conversation.id,
        studentMessage: message,
        retrieval,
        reply: tutorReply,
      });

      return reply.send({ mode: tutorReply.mode, reply: tutorReply.reply });
    }
  );

  // A profile's own conversation list, most recent first - force-scoped
  // like /reports. An admin session can inspect any one profile's via
  // ?profileId=, or omit it to see every conversation combined.
  app.get<{ Querystring: { profileId?: string } }>("/tutor/conversations", async (request) => {
    const identity = request.identity!;
    const profileId = identity.kind === "profile" ? identity.profileId : request.query.profileId;

    // Joined with subjects/classes for display purposes (Section 10 step
    // 9's admin conversation browser) - the ids remain the source of
    // truth everywhere else, this is purely so a human doesn't have to
    // read raw uuids.
    const rows = await db
      .select({
        id: tutorConversations.id,
        profileId: tutorConversations.profileId,
        classId: tutorConversations.classId,
        subjectId: tutorConversations.subjectId,
        startedAt: tutorConversations.startedAt,
        lastMessageAt: tutorConversations.lastMessageAt,
        contextType: tutorConversations.contextType,
        relatedQuestionId: tutorConversations.relatedQuestionId,
        relatedAttemptId: tutorConversations.relatedAttemptId,
        subjectName: subjects.name,
        className: classes.name,
      })
      .from(tutorConversations)
      .innerJoin(subjects, eq(tutorConversations.subjectId, subjects.id))
      .innerJoin(classes, eq(tutorConversations.classId, classes.id))
      .where(profileId ? eq(tutorConversations.profileId, profileId) : undefined)
      .orderBy(desc(tutorConversations.lastMessageAt));
    return rows;
  });

  // One conversation's full transcript - same profile-vs-admin scoping as
  // the message route above.
  app.get<{ Params: { id: string } }>("/tutor/conversations/:id", async (request, reply) => {
    const identity = request.identity!;
    const [conversation] = await db
      .select({
        id: tutorConversations.id,
        profileId: tutorConversations.profileId,
        classId: tutorConversations.classId,
        subjectId: tutorConversations.subjectId,
        startedAt: tutorConversations.startedAt,
        lastMessageAt: tutorConversations.lastMessageAt,
        contextType: tutorConversations.contextType,
        relatedQuestionId: tutorConversations.relatedQuestionId,
        relatedAttemptId: tutorConversations.relatedAttemptId,
        subjectName: subjects.name,
        className: classes.name,
      })
      .from(tutorConversations)
      .innerJoin(subjects, eq(tutorConversations.subjectId, subjects.id))
      .innerJoin(classes, eq(tutorConversations.classId, classes.id))
      .where(eq(tutorConversations.id, request.params.id))
      .limit(1);
    if (!conversation) return reply.status(404).send({ error: "Conversation not found." });
    if (identity.kind === "profile" && conversation.profileId !== identity.profileId) {
      return reply.status(404).send({ error: "Conversation not found." });
    }

    const messages = await db
      .select()
      .from(tutorMessages)
      .where(eq(tutorMessages.conversationId, conversation.id))
      .orderBy(tutorMessages.createdAt);

    return { conversation, messages };
  });
}
