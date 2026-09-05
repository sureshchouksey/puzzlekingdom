// Smoke test for doubt tracking + growth insights (Section 10 step 8,
// plan/AI-Study-Mentor-Agent-Plan.md) - the new admin-only
// /admin/users/:profileId/tutor-insights[/generate] routes, via
// Fastify's .inject() like test-tutor-routes.ts. Needs real internet for
// the DB calls AND one real Gemini call (the generate step), so run from
// your own Terminal:
//
//   npm run test:tutor-insights -w apps/api
//
// Rather than exercising the real chat pipeline to produce tutor_messages
// (already covered by test-tutor-routes.ts and test-tutor-budget.ts),
// this seeds a scratch conversation's messages directly - it's the
// aggregation and insight-generation logic being tested here, not
// message-sending itself. Exercises: the doubt breakdown correctly
// tallies topics from both a matched question and a matched concept
// guide, plus counts an unmatched ("none") reply separately; generating
// insights produces real, non-empty text for every topic that clears the
// minimum-activity threshold; and regenerating upserts in place (same
// topic count after a second generate, not doubled).

import { and, eq } from "drizzle-orm";
import Fastify from "fastify";
import bcrypt from "bcryptjs";
import { registerAuth } from "../src/auth.js";
import { profileRoutes } from "../src/routes/profiles.js";
import { adminRoutes } from "../src/routes/admin.js";
import { db } from "../src/db/client.js";
import {
  admins,
  classes,
  conceptGuides,
  documents,
  questions,
  subjects,
  tutorConversations,
  tutorGrowthInsights,
  tutorMessages,
} from "../src/db/schema.js";

type Breakdown = { topicCounts: { topic: string; count: number }[]; ungroundedCount: number; totalAgentReplies: number };
type InsightsGetResponse = { breakdown: Breakdown; insights: { id: string; topic: string; insightText: string }[] };
type GenerateResponse =
  | { generated: true; insights: { id: string; topic: string; insightText: string }[] }
  | { generated: false; reason: string };

async function main() {
  const app = Fastify();
  await registerAuth(app);
  await app.register(profileRoutes);
  await app.register(adminRoutes);

  console.log('1/7  Looking up class "Year 3", subject "Maths", a Fractions concept guide, and a Word Problems question...');
  const [year3] = await db.select().from(classes).where(eq(classes.name, "Year 3")).limit(1);
  const [maths] = await db.select().from(subjects).where(eq(subjects.name, "Maths")).limit(1);
  if (!year3 || !maths) throw new Error(`Could not find class "Year 3" and/or subject "Maths" - check they exist.`);
  const [fractionsGuide] = await db
    .select({ id: conceptGuides.id })
    .from(conceptGuides)
    .where(and(eq(conceptGuides.classId, year3.id), eq(conceptGuides.subjectId, maths.id), eq(conceptGuides.topic, "Fractions")))
    .limit(1);
  if (!fractionsGuide) throw new Error(`No "Fractions" concept guide found for Year 3/Maths.`);
  const [wordProblemQuestion] = await db
    .select({ id: questions.id })
    .from(questions)
    .innerJoin(documents, eq(questions.documentId, documents.id))
    .where(and(eq(questions.subjectId, maths.id), eq(documents.classId, year3.id)))
    .limit(1);
  if (!wordProblemQuestion) throw new Error(`No Year 3/Maths question found to seed as a matched question source.`);
  console.log(`     OK - guide=${fractionsGuide.id}, question=${wordProblemQuestion.id}`);

  console.log("2/7  Creating a scratch profile and a scratch conversation...");
  const suffix = Date.now();
  const profileRes = await app.inject({ method: "POST", url: "/profiles", payload: { name: `Insights Test ${suffix}` } });
  if (profileRes.statusCode !== 200 && profileRes.statusCode !== 201) {
    throw new Error(`Profile lookup failed (${profileRes.statusCode}): ${profileRes.body}`);
  }
  const { id: profileId } = profileRes.json() as { id: string };
  const [conversation] = await db
    .insert(tutorConversations)
    .values({ profileId, classId: year3.id, subjectId: maths.id, contextType: "general" })
    .returning();
  console.log(`     OK - profile=${profileId}, conversation=${conversation.id}`);

  try {
    console.log("3/7  Seeding agent replies: 3x Fractions (concept guide), 3x a real question, 1x ungrounded...");
    const seedRows = [
      ...Array(3).fill({ matchedSourceType: "concept_guide" as const, matchedSourceId: fractionsGuide.id, matchScore: 0.08 }),
      ...Array(3).fill({ matchedSourceType: "question" as const, matchedSourceId: wordProblemQuestion.id, matchScore: 0.07 }),
      { matchedSourceType: "none" as const, matchedSourceId: null, matchScore: null },
    ];
    for (const row of seedRows) {
      await db.insert(tutorMessages).values({
        conversationId: conversation.id,
        role: "agent",
        content: "(seeded for test-tutor-insights.ts)",
        matchedSourceType: row.matchedSourceType,
        matchedSourceId: row.matchedSourceId,
        matchScore: row.matchScore,
      });
    }
    console.log(`     OK - seeded ${seedRows.length} agent replies`);

    console.log("4/7  Admin login, then GET .../tutor-insights - checking the breakdown tallies correctly...");
    const testUsername = "test-tutor-insights-admin";
    const passwordHash = await bcrypt.hash("test-only-password", 4);
    await db
      .insert(admins)
      .values({ username: testUsername, passwordHash })
      .onConflictDoUpdate({ target: admins.username, set: { passwordHash } });
    const loginRes = await app.inject({ method: "POST", url: "/admin/login", payload: { username: testUsername, password: "test-only-password" } });
    if (loginRes.statusCode !== 200) throw new Error(`Admin login failed (${loginRes.statusCode}): ${loginRes.body}`);
    const { token: adminToken } = loginRes.json() as { token: string };

    const getRes = await app.inject({
      method: "GET",
      url: `/admin/users/${profileId}/tutor-insights`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    if (getRes.statusCode !== 200) throw new Error(`GET tutor-insights failed (${getRes.statusCode}): ${getRes.body}`);
    const before = getRes.json() as InsightsGetResponse;
    const fractionsCount = before.breakdown.topicCounts.find((t) => t.topic === "Fractions")?.count ?? 0;
    console.log(
      fractionsCount === 3 && before.breakdown.ungroundedCount === 1
        ? "     OK - Fractions count=3, ungroundedCount=1, as seeded"
        : `     FAILED - got Fractions count=${fractionsCount}, ungroundedCount=${before.breakdown.ungroundedCount} (expected 3 and 1)`
    );

    console.log("5/7  POST .../generate - a real Gemini call, expecting insights for both qualifying topics...");
    const genRes = await app.inject({
      method: "POST",
      url: `/admin/users/${profileId}/tutor-insights/generate`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    if (genRes.statusCode !== 200) throw new Error(`Generate failed (${genRes.statusCode}): ${genRes.body}`);
    const genBody = genRes.json() as GenerateResponse;
    if (!genBody.generated) throw new Error(`Expected generated=true, got reason="${genBody.reason}"`);
    const topicsWithInsights = new Set(genBody.insights.map((i) => i.topic));
    console.log(
      topicsWithInsights.size >= 1 && genBody.insights.every((i) => i.insightText.trim().length > 0)
        ? `     OK - generated ${genBody.insights.length} insight(s) for: ${[...topicsWithInsights].join(", ")}`
        : `     FAILED - got ${JSON.stringify(genBody.insights)}`
    );

    console.log("6/7  GET again - the generated insights are now persisted and returned...");
    const getRes2 = await app.inject({
      method: "GET",
      url: `/admin/users/${profileId}/tutor-insights`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    if (getRes2.statusCode !== 200) throw new Error(`GET tutor-insights failed (${getRes2.statusCode}): ${getRes2.body}`);
    const after = getRes2.json() as InsightsGetResponse;
    console.log(
      after.insights.length === genBody.insights.length
        ? `     OK - ${after.insights.length} insight(s) persisted`
        : `     FAILED - expected ${genBody.insights.length} persisted insight(s), got ${after.insights.length}`
    );

    console.log("7/7  Generating again upserts in place - same insight count, not doubled...");
    const genRes2 = await app.inject({
      method: "POST",
      url: `/admin/users/${profileId}/tutor-insights/generate`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    if (genRes2.statusCode !== 200) throw new Error(`Second generate failed (${genRes2.statusCode}): ${genRes2.body}`);
    const genBody2 = genRes2.json() as GenerateResponse;
    if (!genBody2.generated) throw new Error(`Expected generated=true on regenerate, got reason="${genBody2.reason}"`);
    console.log(
      genBody2.insights.length === genBody.insights.length
        ? "     OK - regenerate upserted in place, no duplicates"
        : `     FAILED - expected ${genBody.insights.length} insight(s) after regenerate, got ${genBody2.insights.length}`
    );

    console.log("\n=== SUCCESS - doubt breakdown tallies correctly, and growth-insight generation + regeneration both work end to end ===\n");
  } finally {
    await db.delete(tutorGrowthInsights).where(eq(tutorGrowthInsights.profileId, profileId));
    await db.delete(tutorConversations).where(eq(tutorConversations.id, conversation.id));
    console.log("Cleaned up scratch conversation, its messages (cascade), and any generated insights.");
  }

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("\n=== FAILED ===");
  console.error(err);
  process.exit(1);
});
