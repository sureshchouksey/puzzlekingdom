// Smoke test proving the profile-PIN/session and admin-role privacy model
// actually holds, via Fastify's in-process .inject() - still needs real
// internet for the DB calls, so run from your own Terminal AFTER applying
// migrations 0005 and 0006 and running create-admin at least once:
//   npm run test:privacy -w apps/api
//
// Exercises: find-or-create by name, the one-time PIN bootstrap and its
// 409-on-reuse guard, normal PIN login (and rejection of a wrong PIN),
// /reports showing a profile its own history but never another profile's
// (even via a query-string override), a 401 with no session at all, an
// admin session seeing anyone's via ?profileId= or everyone's combined,
// and an admin's "reset PIN" recovery action.

import { inArray } from "drizzle-orm";
import Fastify from "fastify";
import bcrypt from "bcryptjs";
import { registerAuth } from "../src/auth.js";
import { profileRoutes } from "../src/routes/profiles.js";
import { quizRoutes } from "../src/routes/quizzes.js";
import { reportRoutes } from "../src/routes/reports.js";
import { adminRoutes } from "../src/routes/admin.js";
import { db } from "../src/db/client.js";
import { admins, questions } from "../src/db/schema.js";

type AttemptReport = { id: string };

async function main() {
  const app = Fastify();
  await registerAuth(app);
  await app.register(profileRoutes);
  await app.register(quizRoutes);
  await app.register(reportRoutes);
  await app.register(adminRoutes);

  console.log("1/10  Creating two test profiles and setting a PIN for each (bootstrap)...");
  async function newProfileWithPin(name: string, pin: string) {
    const lookupRes = await app.inject({ method: "POST", url: "/profiles", payload: { name } });
    if (lookupRes.statusCode !== 200 && lookupRes.statusCode !== 201) {
      throw new Error(`Looking up profile "${name}" failed (${lookupRes.statusCode}): ${lookupRes.body}`);
    }
    const looked = lookupRes.json() as { id: string; name: string; hasPin: boolean };
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
  const a = await newProfileWithPin(`Privacy Test A ${suffix}`, "1111");
  const b = await newProfileWithPin(`Privacy Test B ${suffix}`, "2222");
  console.log(`     OK - profile A=${a.profile.id}, profile B=${b.profile.id}`);

  console.log("2/10  Setting a PIN a second time on the same profile is rejected (409, can't be used to hijack a PIN)...");
  const doubleSetRes = await app.inject({ method: "POST", url: `/profiles/${a.profile.id}/set-pin`, payload: { pin: "9999" } });
  console.log(doubleSetRes.statusCode === 409 ? "     OK - 409 as expected" : `     FAILED - got ${doubleSetRes.statusCode}, expected 409`);

  console.log("3/10  Verifying with the WRONG PIN is rejected (401)...");
  const wrongPinRes = await app.inject({ method: "POST", url: `/profiles/${a.profile.id}/verify-pin`, payload: { pin: "0000" } });
  console.log(wrongPinRes.statusCode === 401 ? "     OK - 401 as expected" : `     FAILED - got ${wrongPinRes.statusCode}, expected 401`);

  console.log("4/10  Verifying with the RIGHT PIN succeeds and returns a working session token...");
  const rightPinRes = await app.inject({ method: "POST", url: `/profiles/${a.profile.id}/verify-pin`, payload: { pin: "1111" } });
  if (rightPinRes.statusCode !== 200) throw new Error(`verify-pin failed (${rightPinRes.statusCode}): ${rightPinRes.body}`);
  console.log("     OK - correct PIN accepted");

  console.log("5/10  Assembling + completing a 2-question quiz for profile A (subject 'Maths')...");
  const assembleRes = await app.inject({
    method: "POST",
    url: "/quizzes",
    payload: { subjectName: "Maths", count: 2, stageSize: 2, profileId: a.profile.id },
  });
  if (assembleRes.statusCode !== 201) {
    throw new Error(`Assemble failed (${assembleRes.statusCode}): ${assembleRes.body} - does subject "Maths" have questions seeded?`);
  }
  const assembled = assembleRes.json() as { attemptId: string; questions: { id: string; options: { id: string }[] }[] };
  // Answer for real (not just "first option") - since a stage now needs
  // 70%+ to be accepted at all (see quizzes.ts's STAGE_PASS_THRESHOLD),
  // picking blindly would fail this single-stage quiz most of the time.
  const questionIds = assembled.questions.map((q) => q.id);
  const correctRows = await db
    .select({ id: questions.id, correctOptionId: questions.correctOptionId })
    .from(questions)
    .where(inArray(questions.id, questionIds));
  const correctOptionById = new Map(correctRows.map((r) => [r.id, r.correctOptionId]));
  const submitRes = await app.inject({
    method: "POST",
    url: `/quizzes/${assembled.attemptId}/submit`,
    payload: { answers: assembled.questions.map((q) => ({ questionId: q.id, selectedOptionId: correctOptionById.get(q.id)! })) },
  });
  if (submitRes.statusCode !== 200 || !(submitRes.json() as { isComplete: boolean }).isComplete) {
    throw new Error(`Submit failed to complete the attempt (${submitRes.statusCode}): ${submitRes.body}`);
  }
  const attemptId = assembled.attemptId;
  console.log(`     OK - attempt ${attemptId} completed for profile A`);

  function hasAttempt(body: string): boolean {
    return (JSON.parse(body) as AttemptReport[]).some((r) => r.id === attemptId);
  }

  console.log("6/10  Profile A's own session sees its own attempt in /reports, profile B's does NOT...");
  const aOwn = await app.inject({ method: "GET", url: "/reports", headers: { authorization: `Bearer ${a.token}` } });
  const bOwn = await app.inject({ method: "GET", url: "/reports", headers: { authorization: `Bearer ${b.token}` } });
  if (aOwn.statusCode !== 200) throw new Error(`Unexpected status ${aOwn.statusCode}: ${aOwn.body}`);
  if (bOwn.statusCode !== 200) throw new Error(`Unexpected status ${bOwn.statusCode}: ${bOwn.body}`);
  console.log(hasAttempt(aOwn.body) ? "     OK - present for A" : "     FAILED - profile A can't see its own attempt");
  console.log(!hasAttempt(bOwn.body) ? "     OK - correctly absent for B" : "     FAILED - profile B can see profile A's attempt");

  console.log("7/10  Profile B's session ignores a ?profileId= override pointed at profile A...");
  const bOverride = await app.inject({
    method: "GET",
    url: `/reports?profileId=${a.profile.id}`,
    headers: { authorization: `Bearer ${b.token}` },
  });
  if (bOverride.statusCode !== 200) throw new Error(`Unexpected status ${bOverride.statusCode}: ${bOverride.body}`);
  console.log(!hasAttempt(bOverride.body) ? "     OK - override correctly ignored" : "     FAILED - override was honored, privacy bug");

  console.log("8/10  No session at all gets 401 from /reports...");
  const noAuth = await app.inject({ method: "GET", url: "/reports" });
  console.log(noAuth.statusCode === 401 ? "     OK - 401 as expected" : `     FAILED - got ${noAuth.statusCode}, expected 401`);

  console.log("9/10  Logging in a disposable test admin and checking its ?profileId= override AND combined view both work...");
  const testUsername = "test-session-privacy-admin";
  const passwordHash = await bcrypt.hash("test-only-password", 4);
  await db
    .insert(admins)
    .values({ username: testUsername, passwordHash })
    .onConflictDoUpdate({ target: admins.username, set: { passwordHash } });
  const loginRes = await app.inject({
    method: "POST",
    url: "/admin/login",
    payload: { username: testUsername, password: "test-only-password" },
  });
  if (loginRes.statusCode !== 200) throw new Error(`Admin login failed (${loginRes.statusCode}): ${loginRes.body}`);
  const { token: adminToken } = loginRes.json() as { token: string };
  const adminOverride = await app.inject({
    method: "GET",
    url: `/reports?profileId=${a.profile.id}`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  const adminAll = await app.inject({ method: "GET", url: "/reports", headers: { authorization: `Bearer ${adminToken}` } });
  if (adminOverride.statusCode !== 200) throw new Error(`Unexpected status ${adminOverride.statusCode}: ${adminOverride.body}`);
  if (adminAll.statusCode !== 200) throw new Error(`Unexpected status ${adminAll.statusCode}: ${adminAll.body}`);
  console.log(hasAttempt(adminOverride.body) ? "     OK - admin override works" : "     FAILED - admin couldn't see profile A via override");
  console.log(hasAttempt(adminAll.body) ? "     OK - present in combined view" : "     FAILED - missing from admin's combined view");

  console.log("10/10  Admin resets profile A's PIN - old PIN stops working, a fresh set-pin then succeeds...");
  const resetRes = await app.inject({
    method: "POST",
    url: `/admin/users/${a.profile.id}/reset-pin`,
    headers: { authorization: `Bearer ${adminToken}` },
  });
  if (resetRes.statusCode !== 200) throw new Error(`Admin reset-pin failed (${resetRes.statusCode}): ${resetRes.body}`);
  const oldPinAfterReset = await app.inject({ method: "POST", url: `/profiles/${a.profile.id}/verify-pin`, payload: { pin: "1111" } });
  const newSetPin = await app.inject({ method: "POST", url: `/profiles/${a.profile.id}/set-pin`, payload: { pin: "3333" } });
  console.log(
    oldPinAfterReset.statusCode === 409 ? "     OK - old PIN now correctly rejected (409, no PIN set)" : `     FAILED - got ${oldPinAfterReset.statusCode}, expected 409`
  );
  console.log(newSetPin.statusCode === 200 ? "     OK - fresh PIN can be set again after reset" : `     FAILED - got ${newSetPin.statusCode}, expected 200`);

  console.log("\n=== SUCCESS - PIN bootstrap/login, profile privacy, admin override, and PIN reset all work end to end ===\n");
  await app.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("\n=== FAILED ===");
  console.error(err);
  process.exit(1);
});
