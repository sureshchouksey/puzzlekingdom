import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { profiles, tutorConversations, classes, subjects } from "../src/db/schema.js";
import { isTutorEnabled, checkDailyCap, recordTutorExchange, getAppSettings } from "../src/services/tutorBudget.js";
import type { RetrievalResult } from "../src/services/tutorRetrieval.js";
import type { TutorReply } from "../src/services/tutorGeneration.js";

// Database-backed smoke test for tutorBudget.ts (plan/AI-Study-Mentor-Agent-Plan.md,
// Section 10 step 5) - exercises the real app_settings/tutor_conversations/
// tutor_messages tables created by migration 0008 against a real profile,
// not just types. Makes no Gemini calls at all (every recorded exchange is
// a fake "ai"-mode reply with a made-up source) - this is purely about the
// counting/toggle logic, not generation. Creates its own scratch
// conversation and deletes it again at the end, specifically so this never
// pollutes a real profile's actual daily count. Run from apps/api, after
// running migration 0008 in Supabase:
//
//   npx tsx --env-file=.env scripts/test-tutor-budget.ts
//
// Updated 9 September 2026: checkTutorBudget split into isTutorEnabled()
// (the admin on/off toggle - blocks everything) and checkDailyCap()
// (Gemini-cost-only, counts real "ai"-mode exchanges) - see
// tutorBudget.ts's own doc comments for why. The daily-cap loop below now
// records fake exchanges as mode "ai" with a fake matched source, since
// checkDailyCap only counts those, not every message the way the old
// checkTutorBudget did.

const FAKE_NOT_MATCHED: RetrievalResult = { matched: false, sources: [] };
const FAKE_MATCHED: RetrievalResult = {
  matched: true,
  sources: [
    {
      type: "concept_guide",
      id: "00000000-0000-0000-0000-000000000000",
      rank: 1,
      topic: "test",
      title: "test",
      methodText: "test",
      formula: null,
    },
  ],
};
const FAKE_AI_REPLY: TutorReply = { mode: "ai", reply: "test reply", groundedSourceIds: [FAKE_MATCHED.sources[0].id] };

async function main() {
  const [profile] = await db.select().from(profiles).limit(1);
  if (!profile) {
    console.error("No profiles exist - create one before running this.");
    process.exit(1);
  }
  console.log(`Using profile "${profile.name}" (${profile.id})\n`);

  // The scratch conversation now needs a real classId/subjectId (migration
  // 0009 - tutor_conversations didn't originally record these, see that
  // migration's own comment for why) - reuse the same "Year 3"/"Maths"
  // lookup test-tutor-retrieval.ts uses, since budget logic itself doesn't
  // care which class/subject, only that the row satisfies the not-null FKs.
  const [year3] = await db.select().from(classes).where(eq(classes.name, "Year 3")).limit(1);
  const [maths] = await db.select().from(subjects).where(eq(subjects.name, "Maths")).limit(1);
  if (!year3 || !maths) {
    console.error(`Could not find class "Year 3" and/or subject "Maths" - check they exist before running this.`);
    process.exit(1);
  }

  const settings = await getAppSettings();
  console.log(
    `app_settings: tutorEnabled=${settings.tutorEnabled}, dailyCapPerProfile=${settings.tutorDailyCapPerProfile}, sharedDailyBudget=${settings.tutorSharedDailyBudget}\n`
  );

  const [conversation] = await db
    .insert(tutorConversations)
    .values({ profileId: profile.id, classId: year3.id, subjectId: maths.id })
    .returning();
  console.log(`Created scratch conversation ${conversation.id}\n`);

  try {
    console.log("=== Before any fake messages ===");
    let check = await checkDailyCap(profile.id);
    console.log(check);
    if (!check.allowed) {
      console.log(
        "NOTE: this profile already has real Gemini-answered usage today - the cap test below may trip immediately instead of after N messages. That's expected if so, not a bug."
      );
    }

    console.log(`\n=== Recording ${settings.tutorDailyCapPerProfile} fake "ai"-mode exchanges ===`);
    for (let i = 0; i < settings.tutorDailyCapPerProfile; i++) {
      await recordTutorExchange({
        conversationId: conversation.id,
        studentMessage: `test message ${i + 1}`,
        retrieval: FAKE_MATCHED,
        reply: FAKE_AI_REPLY,
      });
    }

    console.log("\n=== After hitting the cap ===");
    check = await checkDailyCap(profile.id);
    console.log(check);
    if (check.allowed) {
      console.log("CHECK: expected allowed=false by now - something's off.");
    } else {
      console.log("OK: cap correctly reached.");
    }

    console.log("\n=== A fake template-mode (non-Gemini) exchange should NOT count ===");
    const beforeTemplate = await checkDailyCap(profile.id);
    await recordTutorExchange({
      conversationId: conversation.id,
      studentMessage: "an unmatched question",
      retrieval: FAKE_NOT_MATCHED,
      reply: { mode: "template", reply: "test reply", groundedSourceIds: [] },
    });
    const afterTemplate = await checkDailyCap(profile.id);
    if (!beforeTemplate.allowed && !afterTemplate.allowed && beforeTemplate.usedToday === afterTemplate.usedToday) {
      console.log("OK: a template-mode (no real Gemini call) exchange didn't move usedToday.");
    } else {
      console.log("CHECK: expected usedToday to stay unchanged - something's off.", { beforeTemplate, afterTemplate });
    }

    console.log("\n=== Toggling tutor_enabled off ===");
    await db.execute(sql`update app_settings set tutor_enabled = false where id = true`);
    const enabled = await isTutorEnabled();
    console.log({ tutorEnabled: enabled });
    if (!enabled) {
      console.log("OK: the off toggle reports disabled, independently of the daily cap.");
    } else {
      console.log("CHECK: expected isTutorEnabled() to return false - something's off.");
    }
    await db.execute(sql`update app_settings set tutor_enabled = true where id = true`);
    console.log("(restored tutor_enabled = true)");
  } finally {
    // Cleanup - deleting the conversation cascades to its tutor_messages
    // (migration 0008's ON DELETE CASCADE), so none of this fake usage
    // counts against the profile's real cap after this script exits.
    await db.delete(tutorConversations).where(eq(tutorConversations.id, conversation.id));
    console.log(`\nCleaned up scratch conversation ${conversation.id}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
