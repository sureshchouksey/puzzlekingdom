import type { FastifyInstance } from "fastify";
import { eq, and, desc, gte } from "drizzle-orm";
import { db } from "../db/client.js";
import { classes, subjects, tutorConversations, tutorMessages } from "../db/schema.js";
import { requireIdentity } from "../auth.js";
import { checkTutorBudget, recordTutorExchange } from "../services/tutorBudget.js";
import { retrieveForQuery, retrieveForQuestion } from "../services/tutorRetrieval.js";
import { generateTutorReply } from "../services/tutorGeneration.js";

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
    return reply.status(201).send(created);
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
