import type { FastifyInstance } from "fastify";
import { eq, and, desc, gte } from "drizzle-orm";
import { db } from "../db/client.js";
import { classes, subjects, tutorConversations, tutorMessages } from "../db/schema.js";
import { requireIdentity } from "../auth.js";
import { checkTutorBudget, recordTutorExchange, recordSimpleTutorExchange } from "../services/tutorBudget.js";
import { retrieveForQuery, retrieveForQuestion } from "../services/tutorRetrieval.js";
import { generateTutorReply } from "../services/tutorGeneration.js";
import { classifyTutorIntent } from "../services/tutorIntent.js";
import { getRandomFunContent, getFunContentById, formatFunContentReply, formatFunContentAnswer } from "../services/funContent.js";
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

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// Was a riddle/joke/puzzle/trivia question - or this app's own offer to
// reveal one after a wrong guess - the very last thing said in this
// conversation? If so, the child's next message is very likely about that
// question (see tutorIntent.ts's answer_attempt/reveal_answer intents and
// the context-aware classification they do), not a fresh request or lesson
// question. Deliberately strict about "the very last message" - once
// anything else has happened since (a reveal, a correct guess, a new
// fun-content item, an academic reply), the window closes and the next
// message is classified fresh instead of being forced against a stale
// question. Returns null (nothing pending) when the item has no answerText
// at all (e.g. a tongue twister) - there's nothing to guess or reveal.
//
// `offeredReveal` on the return value distinguishes the two states: false
// means the original question was just asked (a plain guess is expected
// next); true means the child already guessed wrong once and was just
// asked "want a hint, or should I tell you the answer?" (see tutor.ts's
// INCORRECT_GUESS_REPLIES below) - a short "yes"/"sure" next should be
// read as accepting that offer, not as another blind guess.
async function getPendingFunContent(conversationId: string) {
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
  if (
    !lastMessage ||
    lastMessage.role !== "agent" ||
    !lastMessage.sourceId ||
    (lastMessage.sourceType !== "fun_content" && lastMessage.sourceType !== "reveal_offer")
  ) {
    return null;
  }
  const item = await getFunContentById(lastMessage.sourceId);
  if (!item || !item.answerText) return null;
  return { ...item, offeredReveal: lastMessage.sourceType === "reveal_offer" };
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

  // The actual chat turn: budget check -> retrieval -> generation ->
  // record, each step short-circuiting the next when it doesn't need to
  // run. A capped-out or disabled profile never reaches retrieval or
  // generation at all - the cost-consciousness in Section 6/9 extends to
  // this route, not just the modules it calls.
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

      const budget = await checkTutorBudget(conversation.profileId);
      if (!budget.allowed) {
        const replyText = budget.reason === "tutor_disabled" ? TUTOR_DISABLED_REPLY : DAILY_CAP_REPLY;
        return reply.send({ mode: "blocked", reason: budget.reason, reply: replyText });
      }

      // Intent classification only applies to the free-text "general"
      // chat - a 'question' conversation's whole point is explaining one
      // specific wrong answer (its first message is the question text
      // itself, auto-sent by the frontend), so there's no ambiguity to
      // resolve and skipping this call keeps that flow both faster and
      // immune to a misclassification derailing it. See tutorIntent.ts.
      if (conversation.contextType === "general") {
        const pendingItem = await getPendingFunContent(conversation.id);
        const intent = await classifyTutorIntent(
          message,
          pendingItem
            ? { promptText: pendingItem.promptText, answerText: pendingItem.answerText!, offeredReveal: pendingItem.offeredReveal }
            : undefined
        );

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

        if (intent.kind === "reveal_answer") {
          // Find the most recent fun_content this conversation actually
          // served - formatFunContentReply deliberately withholds the
          // answer up front (see its own doc comment), so "what's the
          // answer"/"I give up" needs to look back at whichever
          // riddle/joke/puzzle/trivia question was sent last to know
          // which answer to give. If nothing fun_content has been sent
          // yet in this conversation, there's nothing to reveal.
          const [lastFunMessage] = await db
            .select({ sourceId: tutorMessages.matchedSourceId })
            .from(tutorMessages)
            .where(and(eq(tutorMessages.conversationId, conversation.id), eq(tutorMessages.matchedSourceType, "fun_content")))
            .orderBy(desc(tutorMessages.createdAt))
            .limit(1);
          const item = lastFunMessage?.sourceId ? await getFunContentById(lastFunMessage.sourceId) : null;
          const replyText = item
            ? formatFunContentAnswer(item)
            : "I haven't asked you a riddle, joke, or puzzle yet this chat - want one? Just ask!";
          await recordSimpleTutorExchange({
            conversationId: conversation.id,
            studentMessage: message,
            replyText,
            // Always 'social', never 'fun_content' - revealing an answer
            // closes the pending-question window (getPendingFunContent
            // above only looks at the very last message), so the child's
            // next message is classified fresh rather than re-checked as
            // another guess at a question they've already been told.
            sourceType: "social",
          });
          return reply.send({ mode: "template", reply: replyText });
        }

        if (intent.kind === "answer_attempt") {
          // pendingItem is guaranteed set here - classifyTutorIntent only
          // ever returns answer_attempt when it was given pending context
          // to judge against in the first place (see tutorIntent.ts).
          const replyText = pickRandom(intent.correct ? CORRECT_GUESS_REPLIES : INCORRECT_GUESS_REPLIES);
          await recordSimpleTutorExchange({
            conversationId: conversation.id,
            studentMessage: message,
            replyText,
            // A correct guess closes the window entirely - 'social',
            // nothing left to guess or reveal. An incorrect guess instead
            // reopens it as 'reveal_offer': INCORRECT_GUESS_REPLIES just
            // asked "want a hint, or should I tell you the answer?", so
            // getPendingFunContent above needs to recognize a short "yes"
            // next turn as accepting that offer (tutorIntent.ts's
            // offeredReveal handling) rather than as a fresh guess.
            sourceType: intent.correct ? "social" : "reveal_offer",
            sourceId: intent.correct ? undefined : pendingItem!.id,
          });
          return reply.send({ mode: "template", reply: replyText });
        }
        // intent.kind === "academic" falls through to the existing
        // retrieval -> generation pipeline below, unchanged.
      }

      const retrieval =
        conversation.contextType === "question"
          ? await retrieveForQuestion({
              questionId: conversation.relatedQuestionId!,
              classId: conversation.classId,
              subjectId: conversation.subjectId,
            })
          : await retrieveForQuery({
              queryText: message,
              classId: conversation.classId,
              subjectId: conversation.subjectId,
            });

      const tutorReply = await generateTutorReply({ queryText: message, retrieval });

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
