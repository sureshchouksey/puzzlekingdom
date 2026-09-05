import { eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { classes, subjects } from "../src/db/schema.js";
import { retrieveForQuery } from "../src/services/tutorRetrieval.js";
import { generateTutorReply, TEMPLATE_FALLBACK_REPLY } from "../src/services/tutorGeneration.js";

// Calibration/smoke script for tutorGeneration.ts (plan/AI-Study-Mentor-Agent-Plan.md,
// Section 10 step 4) - same spirit as test-tutor-retrieval.ts: not a pass/fail
// suite, a way to actually read real Gemini replies and judge them by eye
// (right reading level? actually grounded in the material, not padded out
// with outside facts? honest when it should be?) before trusting this in
// the real chat route. Needs a real GEMINI_API_KEY in .env, and makes real
// (free-tier) API calls - run from apps/api:
//
//   npx tsx --env-file=.env scripts/test-tutor-generation.ts

async function main() {
  const [year3] = await db.select().from(classes).where(eq(classes.name, "Year 3")).limit(1);
  const [maths] = await db.select().from(subjects).where(eq(subjects.name, "Maths")).limit(1);

  if (!year3 || !maths) {
    console.error(`Could not find class "Year 3" and/or subject "Maths" - check they exist before running this.`);
    process.exit(1);
  }

  // A small, deliberate mix: a couple of genuine matches (different source
  // shapes - one should surface a concept guide, one a question) worth
  // reading closely for tone and grounding, plus one clean non-match to
  // confirm the honest fallback fires WITHOUT a Gemini call (no API delay,
  // and the reply is the exact template string, not a generated "sorry"
  // that looks similar but cost a real request).
  const cases = [
    { text: "how do I add fractions", note: "expect an AI reply grounded in the Fractions concept guide" },
    { text: "how do I tell the time on a clock", note: "expect an AI reply grounded in the Time concept guide" },
    { text: "what is the biggest planet in the solar system", note: "expect the honest template fallback, no Gemini call" },
  ];

  for (const c of cases) {
    console.log(`\n=== "${c.text}" ===`);
    console.log(`(${c.note})`);

    const retrieval = await retrieveForQuery({ queryText: c.text, classId: year3.id, subjectId: maths.id });
    console.log(`retrieval: matched=${retrieval.matched}, ${retrieval.sources.length} source(s)`);
    // Print what was actually handed to Gemini as grounding material, so a
    // human reading this output can check the reply below against it
    // directly - "did it only use what's here?" - without a separate DB
    // query. This is the actual verification step Section 10 step 4's
    // open question calls for, not just a vibe check on tone.
    for (const s of retrieval.sources) {
      if (s.type === "concept_guide") {
        console.log(`  [guide ${s.rank.toFixed(4)}] ${s.topic} - ${s.title}: ${s.methodText}${s.formula ? ` (formula: ${s.formula})` : ""}`);
      } else {
        console.log(`  [question ${s.rank.toFixed(4)}] ${s.questionText} -> ${s.explanation}`);
      }
    }

    const started = Date.now();
    const result = await generateTutorReply({ queryText: c.text, retrieval });
    const elapsedMs = Date.now() - started;

    console.log(`mode=${result.mode} (${elapsedMs}ms), groundedSourceIds=[${result.groundedSourceIds.join(", ")}]`);
    if (result.mode === "template" && result.reply !== TEMPLATE_FALLBACK_REPLY) {
      console.log("CHECK: mode=template but reply text doesn't match the known fallback string - unexpected.");
    }
    console.log(`reply: ${result.reply}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
