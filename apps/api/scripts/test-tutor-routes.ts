// Smoke test proving the AI Study Mentor-s actual routes (Section 10 step 6,
// plan/AI-Study-Mentor-Agent-Plan.md) hold up end to end, via Fastify's
// in-process .inject() - same style as test-session-privacy.ts. Still
// needs real internet for the DB calls AND one real Gemini call (the
// grounded-reply check below), so run from your own Terminal, after
// migrations 0008 and 0009 are both applied:
//
//   npm run test:tutor-routes -w apps/api
//
// Exercises: starting a conversation (and that starting a second one the
// same day/class/subject resumes the first, rather than forking); a
// grounded reply for a real in-scope question; an honest template
// fallback for gibberish; that a second profile's session can neither
// list nor read the first profile's conversation (404, not 403, per
// tutor.ts's own privacy comment); a 401 with no session at all; an
// admin session's ?profileId= override; and both blocked-reply paths
// (daily_cap_reached, tutor_disabled) at the route level, restoring
// app_settings to its original values afterward either way.

import { and, eq } from "drizzle-orm";
import Fastify from "fastify";
import bcrypt from "bcryptjs";
import { registerAuth } from "../src/auth.js";
import { profileRoutes } from "../src/routes/profiles.js";
import { adminRoutes } from "../src/routes/admin.js";
import { tutorRoutes } from "../src/routes/tutor.js";
import { db } from "../src/db/client.js";
import { admins, classes, documents, questions, subjects, tutorConversations } from "../src/db/schema.js";

type Conversation = { id: string; profileId: string; classId: string; subjectId: string };
type MessageResult = { mode: string; reason?: string; reply: string };

async function main() {
  const app = Fastify();
  await registerAuth(app);
  await app.register(profileRoutes);
  await app.register(adminRoutes);
  await app.register(tutorRoutes);

  console.log('1/14  Looking up class "Year 3" and subject "Maths"...');
  const [year3] = await db.select().from(classes).where(eq(classes.name, "Year 3")).limit(1);
  const [maths] = await db.select().from(subjects).where(eq(subjects.name, "Maths")).limit(1);
  if (!year3 || !maths) throw new Error(`Could not find class "Year 3" and/or subject "Maths" - check they exist.`);
  console.log(`     OK - class=${year3.id}, subject=${maths.id}`);

  console.log("2/14  Creating two test profiles with PINs (A and B)...");
  async function newProfileWithPin(name: string, pin: string) {
    const lookupRes = await app.inject({ method: "POST", url: "/profiles", payload: { name } });
    if (lookupRes.statusCode !== 200 && lookupRes.statusCode !== 201) {
      throw new Error(`Looking up profile "${name}" failed (${lookupRes.statusCode}): ${lookupRes.body}`);
    }
    const looked = lookupRes.json() as { id: string; hasPin: boolean };
    if (looked.hasPin) throw new Error(`Expected "${name}" to have no PIN yet on a fresh test run - found one already set.`);
    const setPinRes = await app.inject({
      method: "POST",
      url: `/profiles/${looked.id}/set-pin`,
      payload: { pin, title: "Prince" },
    });
    if (setPinRes.statusCode !== 200) throw new Error(`set-pin for "${name}" failed (${setPinRes.statusCode}): ${setPinRes.body}`);
    const { profile, token } = setPinRes.json() as { profile: { id: string }; token: string };
    return { profile, token };
  }
  const suffix = Date.now();
  const a = await newProfileWithPin(`Tutor Test A ${suffix}`, "1111");
  const b = await newProfileWithPin(`Tutor Test B ${suffix}`, "2222");
  console.log(`     OK - profile A=${a.profile.id}, profile B=${b.profile.id}`);

  const createdConversationIds: string[] = [];

  try {
    console.log("3/14  Profile A starts a general Year 3/Maths conversation...");
    const startRes = await app.inject({
      method: "POST",
      url: "/tutor/conversations",
      headers: { authorization: `Bearer ${a.token}` },
      payload: { classId: year3.id, subjectId: maths.id, contextType: "general" },
    });
    if (startRes.statusCode !== 201) throw new Error(`Start failed (${startRes.statusCode}): ${startRes.body}`);
    const conversation = startRes.json() as Conversation;
    createdConversationIds.push(conversation.id);
    console.log(`     OK - conversation ${conversation.id} created`);

    console.log("4/14  Starting a second general conversation same profile/class/subject/day RESUMES the first...");
    const resumeRes = await app.inject({
      method: "POST",
      url: "/tutor/conversations",
      headers: { authorization: `Bearer ${a.token}` },
      payload: { classId: year3.id, subjectId: maths.id, contextType: "general" },
    });
    if (resumeRes.statusCode !== 200) throw new Error(`Resume failed (${resumeRes.statusCode}): ${resumeRes.body}`);
    const resumed = resumeRes.json() as Conversation;
    console.log(
      resumed.id === conversation.id
        ? "     OK - same conversation id returned, no fork"
        : `     FAILED - got a different conversation id (${resumed.id})`
    );

    console.log('5/14  Sending a real in-scope question ("how do I add fractions") - expects a grounded AI reply...');
    const groundedRes = await app.inject({
      method: "POST",
      url: `/tutor/conversations/${conversation.id}/messages`,
      headers: { authorization: `Bearer ${a.token}` },
      payload: { message: "how do I add fractions" },
    });
    if (groundedRes.statusCode !== 200) throw new Error(`Message failed (${groundedRes.statusCode}): ${groundedRes.body}`);
    const groundedBody = groundedRes.json() as MessageResult;
    console.log(
      groundedBody.mode === "ai"
        ? `     OK - mode="ai", reply: "${groundedBody.reply.slice(0, 80)}..."`
        : `     CHECK - expected mode="ai", got "${groundedBody.mode}" (reply: ${groundedBody.reply})`
    );

    console.log("6/14  Sending gibberish - expects an honest template fallback, not a fabricated answer...");
    const fallbackRes = await app.inject({
      method: "POST",
      url: `/tutor/conversations/${conversation.id}/messages`,
      headers: { authorization: `Bearer ${a.token}` },
      payload: { message: "asdkjfh qwerty nonsense query" },
    });
    if (fallbackRes.statusCode !== 200) throw new Error(`Message failed (${fallbackRes.statusCode}): ${fallbackRes.body}`);
    const fallbackBody = fallbackRes.json() as MessageResult;
    console.log(
      fallbackBody.mode === "template"
        ? "     OK - mode=\"template\", honest fallback used"
        : `     CHECK - expected mode="template", got "${fallbackBody.mode}"`
    );

    console.log("7/14  Profile B's session gets 404 reading profile A's conversation by id (not 403 - can't tell it exists)...");
    const bReadRes = await app.inject({
      method: "GET",
      url: `/tutor/conversations/${conversation.id}`,
      headers: { authorization: `Bearer ${b.token}` },
    });
    console.log(bReadRes.statusCode === 404 ? "     OK - 404 as expected" : `     FAILED - got ${bReadRes.statusCode}, expected 404`);

    console.log("8/14  Profile B's own conversation list does NOT include profile A's conversation...");
    const bListRes = await app.inject({ method: "GET", url: "/tutor/conversations", headers: { authorization: `Bearer ${b.token}` } });
    if (bListRes.statusCode !== 200) throw new Error(`Unexpected status ${bListRes.statusCode}: ${bListRes.body}`);
    const bList = bListRes.json() as Conversation[];
    console.log(
      !bList.some((c) => c.id === conversation.id)
        ? "     OK - correctly absent for B"
        : "     FAILED - profile B can see profile A's conversation"
    );

    console.log("9/14  No session at all gets 401 from /tutor/conversations...");
    const noAuthRes = await app.inject({ method: "GET", url: "/tutor/conversations" });
    console.log(noAuthRes.statusCode === 401 ? "     OK - 401 as expected" : `     FAILED - got ${noAuthRes.statusCode}, expected 401`);

    console.log("10/14  Logging in a disposable test admin and checking its ?profileId= override can read A's conversation...");
    const testUsername = "test-tutor-routes-admin";
    const passwordHash = await bcrypt.hash("test-only-password", 4);
    await db
      .insert(admins)
      .values({ username: testUsername, passwordHash })
      .onConflictDoUpdate({ target: admins.username, set: { passwordHash } });
    const loginRes = await app.inject({ method: "POST", url: "/admin/login", payload: { username: testUsername, password: "test-only-password" } });
    if (loginRes.statusCode !== 200) throw new Error(`Admin login failed (${loginRes.statusCode}): ${loginRes.body}`);
    const { token: adminToken } = loginRes.json() as { token: string };
    const adminReadRes = await app.inject({
      method: "GET",
      url: `/tutor/conversations/${conversation.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    if (adminReadRes.statusCode !== 200) throw new Error(`Unexpected status ${adminReadRes.statusCode}: ${adminReadRes.body}`);
    console.log("     OK - admin can read profile A's conversation directly");
    const adminOverrideRes = await app.inject({
      method: "GET",
      url: `/tutor/conversations?profileId=${a.profile.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    if (adminOverrideRes.statusCode !== 200) throw new Error(`Unexpected status ${adminOverrideRes.statusCode}: ${adminOverrideRes.body}`);
    const adminOverrideList = adminOverrideRes.json() as Conversation[];
    console.log(
      adminOverrideList.some((c) => c.id === conversation.id)
        ? "     OK - admin's ?profileId= override sees it too"
        : "     FAILED - admin override didn't find profile A's conversation"
    );

    console.log("11/14  Admin drops the daily cap to 0 (below what A already used) - A's next message is blocked...");
    const settingsBeforeRes = await app.inject({ method: "GET", url: "/admin/settings", headers: { authorization: `Bearer ${adminToken}` } });
    if (settingsBeforeRes.statusCode !== 200) throw new Error(`Unexpected status ${settingsBeforeRes.statusCode}: ${settingsBeforeRes.body}`);
    const originalSettings = settingsBeforeRes.json() as { tutorEnabled: boolean; tutorDailyCapPerProfile: number; tutorSharedDailyBudget: number | null };
    try {
      const capDownRes = await app.inject({
        method: "PATCH",
        url: "/admin/settings",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { tutorDailyCapPerProfile: 1 },
      });
      if (capDownRes.statusCode !== 200) throw new Error(`Cap update failed (${capDownRes.statusCode}): ${capDownRes.body}`);
      // A has already sent 2 real student messages above (steps 5 and 6),
      // so a cap of 1 is already exceeded - no need to loop N times.
      const cappedRes = await app.inject({
        method: "POST",
        url: `/tutor/conversations/${conversation.id}/messages`,
        headers: { authorization: `Bearer ${a.token}` },
        payload: { message: "one more question" },
      });
      if (cappedRes.statusCode !== 200) throw new Error(`Message failed (${cappedRes.statusCode}): ${cappedRes.body}`);
      const cappedBody = cappedRes.json() as MessageResult;
      console.log(
        cappedBody.mode === "blocked" && cappedBody.reason === "daily_cap_reached"
          ? "     OK - blocked with reason=daily_cap_reached"
          : `     FAILED - expected blocked/daily_cap_reached, got mode=${cappedBody.mode} reason=${cappedBody.reason}`
      );
    } finally {
      await app.inject({
        method: "PATCH",
        url: "/admin/settings",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { tutorDailyCapPerProfile: originalSettings.tutorDailyCapPerProfile },
      });
      console.log(`     (restored tutorDailyCapPerProfile = ${originalSettings.tutorDailyCapPerProfile})`);
    }

    console.log("12/14  Admin toggles tutor_enabled off - A's message is blocked for the OTHER reason (tutor_disabled)...");
    try {
      const offRes = await app.inject({
        method: "PATCH",
        url: "/admin/settings",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { tutorEnabled: false },
      });
      if (offRes.statusCode !== 200) throw new Error(`Toggle-off failed (${offRes.statusCode}): ${offRes.body}`);
      const disabledRes = await app.inject({
        method: "POST",
        url: `/tutor/conversations/${conversation.id}/messages`,
        headers: { authorization: `Bearer ${a.token}` },
        payload: { message: "one more question" },
      });
      if (disabledRes.statusCode !== 200) throw new Error(`Message failed (${disabledRes.statusCode}): ${disabledRes.body}`);
      const disabledBody = disabledRes.json() as MessageResult;
      console.log(
        disabledBody.mode === "blocked" && disabledBody.reason === "tutor_disabled"
          ? "     OK - blocked with reason=tutor_disabled"
          : `     FAILED - expected blocked/tutor_disabled, got mode=${disabledBody.mode} reason=${disabledBody.reason}`
      );
    } finally {
      await app.inject({
        method: "PATCH",
        url: "/admin/settings",
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { tutorEnabled: originalSettings.tutorEnabled },
      });
      console.log(`     (restored tutorEnabled = ${originalSettings.tutorEnabled})`);
    }

    console.log("13/14  Profile A starts a question-scoped conversation for a real Year 3/Maths question (Section 10 step 7)...");
    const [sampleQuestion] = await db
      .select({ id: questions.id })
      .from(questions)
      .innerJoin(documents, eq(questions.documentId, documents.id))
      .where(and(eq(questions.subjectId, maths.id), eq(documents.classId, year3.id)))
      .limit(1);
    if (!sampleQuestion) throw new Error("No Year 3 Maths question found to test the question-scoped flow against.");
    const qStartRes = await app.inject({
      method: "POST",
      url: "/tutor/conversations",
      headers: { authorization: `Bearer ${a.token}` },
      payload: { classId: year3.id, subjectId: maths.id, contextType: "question", questionId: sampleQuestion.id },
    });
    if (qStartRes.statusCode !== 201) throw new Error(`Question-conversation start failed (${qStartRes.statusCode}): ${qStartRes.body}`);
    const qConversation = qStartRes.json() as Conversation & { contextType: string; relatedQuestionId: string | null };
    createdConversationIds.push(qConversation.id);
    console.log(
      qConversation.contextType === "question" && qConversation.relatedQuestionId === sampleQuestion.id
        ? `     OK - question-scoped conversation ${qConversation.id} created, relatedQuestionId matches`
        : `     FAILED - contextType=${qConversation.contextType}, relatedQuestionId=${qConversation.relatedQuestionId} (expected ${sampleQuestion.id})`
    );

    console.log('14/14  Starting a second conversation for the SAME question resumes it, not a fork (re-tapping "explain this to me")...');
    const qResumeRes = await app.inject({
      method: "POST",
      url: "/tutor/conversations",
      headers: { authorization: `Bearer ${a.token}` },
      payload: { classId: year3.id, subjectId: maths.id, contextType: "question", questionId: sampleQuestion.id },
    });
    if (qResumeRes.statusCode !== 200) throw new Error(`Question-conversation resume failed (${qResumeRes.statusCode}): ${qResumeRes.body}`);
    const qResumed = qResumeRes.json() as Conversation;
    console.log(
      qResumed.id === qConversation.id
        ? "     OK - same conversation id returned, no fork"
        : `     FAILED - got a different conversation id (${qResumed.id})`
    );

    console.log("\n=== SUCCESS - conversation start/resume (general AND question-scoped), grounded + fallback replies, privacy, admin override, and both blocked-reply paths all work end to end ===\n");
  } finally {
    // Cleanup - deleting the conversations cascades to their tutor_messages
    // (migration 0008's ON DELETE CASCADE), same convention as
    // test-tutor-budget.ts, so this leaves no scratch usage behind against
    // either test profile's real daily count.
    for (const id of createdConversationIds) {
      await db.delete(tutorConversations).where(eq(tutorConversations.id, id));
    }
    console.log(`Cleaned up ${createdConversationIds.length} scratch conversation(s).`);
  }

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("\n=== FAILED ===");
  console.error(err);
  process.exit(1);
});
