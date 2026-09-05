import { eq, and } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { classes, subjects, questions } from "../src/db/schema.js";
import { retrieveForQuery, retrieveForQuestion } from "../src/services/tutorRetrieval.js";

// Calibration/smoke script for tutorRetrieval.ts (plan/AI-Study-Mentor-Agent-Plan.md,
// Section 10 step 3) - NOT a pass/fail test suite like test-quiz-flow.ts or
// test-session-privacy.ts. Its whole job is printing real `rank` numbers
// for real queries against the live Year 3 Maths content, since
// MATCH_THRESHOLD (currently 0.05) was picked without any real usage data
// - see the doc comment on that constant. Run this, look at the numbers,
// and only then decide whether 0.05 is actually a sane cutoff or needs
// moving. Same INIT_CWD-relative convention as seed-concept-guides.ts -
// run from apps/api:
//
//   npx tsx --env-file=.env scripts/test-tutor-retrieval.ts

async function main() {
  const [year3] = await db.select().from(classes).where(eq(classes.name, "Year 3")).limit(1);
  const [maths] = await db.select().from(subjects).where(eq(subjects.name, "Maths")).limit(1);

  if (!year3 || !maths) {
    console.error(`Could not find class "Year 3" and/or subject "Maths" - check they exist before running this.`);
    process.exit(1);
  }

  console.log(`Using class "Year 3" (${year3.id}), subject "Maths" (${maths.id})\n`);

  // A deliberate mix: things that SHOULD match (one per authored topic,
  // phrased the way a Year 3 child might actually type it, not using the
  // exact tag string), and things that SHOULD NOT match, to check the
  // honest-fallback side isn't accidentally matching everything.
  const queries = [
    { text: "how do I add fractions", expectMatch: true, note: "should hit Fractions" },
    { text: "what is a right angle", expectMatch: true, note: "should hit Geometry & Shape" },
    { text: "how do I tell the time on a clock", expectMatch: true, note: "should hit Time" },
    { text: "how many grams are in a kilogram", expectMatch: true, note: "should hit Measurement & Units" },
    { text: "how do I read a bar chart", expectMatch: true, note: "should hit Statistics & Data Handling" },
    { text: "what is the value of a digit in a number", expectMatch: true, note: "should hit Place Value" },
    { text: "what is the biggest planet in the solar system", expectMatch: false, note: "science, not maths - should be honest not-found" },
    { text: "who was the first king of england", expectMatch: false, note: "history, not maths - should be honest not-found" },
    { text: "asdkjfh qwerty nonsense query", expectMatch: false, note: "gibberish - should be honest not-found" },
  ];

  console.log("=== retrieveForQuery ===\n");
  for (const q of queries) {
    const result = await retrieveForQuery({ queryText: q.text, classId: year3.id, subjectId: maths.id });
    const top = result.sources[0];
    const flag = result.matched === q.expectMatch ? "OK  " : "CHECK";
    console.log(
      `[${flag}] "${q.text}"\n` +
        `        expected match=${q.expectMatch}, got match=${result.matched}` +
        (top ? `, top rank=${top.rank.toFixed(4)} (${top.type}: ${"title" in top ? top.title : top.questionText.slice(0, 60)})` : ", no sources at all") +
        `\n        (${q.note})\n`
    );
  }

  console.log("\n=== retrieveForQuestion ===\n");
  // Grab one real Year 3 Maths question to exercise the "explain this
  // wrong answer" path - this should always be matched:true regardless of
  // MATCH_THRESHOLD, since it's a direct lookup, not a search.
  const [sampleQuestion] = await db
    .select()
    .from(questions)
    .where(and(eq(questions.subjectId, maths.id)))
    .limit(1);

  if (!sampleQuestion) {
    console.log("No Year 3 Maths questions found to test retrieveForQuestion against.");
  } else {
    const result = await retrieveForQuestion({
      questionId: sampleQuestion.id,
      classId: year3.id,
      subjectId: maths.id,
    });
    console.log(`Question: "${sampleQuestion.questionText.slice(0, 80)}..."`);
    console.log(`matched=${result.matched} (should always be true), ${result.sources.length} source(s) returned:`);
    for (const s of result.sources) {
      console.log(`  - ${s.type}: ${"title" in s ? s.title : s.questionText.slice(0, 60)} (rank ${s.rank})`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});