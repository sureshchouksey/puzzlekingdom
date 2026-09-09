import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { quizAttempts, subjects } from "../db/schema.js";
import { env } from "../env.js";
import { getGeminiClient, isRetryableStatus } from "./providers/gemini.js";

// Builds the warm, proactive opening message a child sees the moment a
// NEW Study Buddy conversation starts (see tutor.ts's POST
// /tutor/conversations) - never for a resumed one, so it only ever
// appears once per real conversation, not on every page reload. Two
// things make this feel like "freely discussing with an AI" rather than
// a blank chat box waiting for the first message: a real hello, and -
// when there's genuine recent progress to point to - an honest,
// specific congratulation grounded in that profile's own quiz_attempts
// (never invented), the same "only ever describe real data" discipline
// tutorInsights.ts's growth insights already follow.

export interface RecentProgress {
  subjectName: string;
  score: number | null;
  totalQuestions: number;
  stagesCleared: number;
  completedAt: Date;
}

/** The profile's single most recent completed quiz attempt, if any. */
async function getMostRecentProgress(profileId: string): Promise<RecentProgress | null> {
  const [row] = await db
    .select({
      subjectName: subjects.name,
      score: quizAttempts.score,
      totalQuestions: quizAttempts.totalQuestions,
      stagesCleared: quizAttempts.stagesCleared,
      completedAt: quizAttempts.completedAt,
    })
    .from(quizAttempts)
    .innerJoin(subjects, eq(quizAttempts.subjectId, subjects.id))
    .where(and(eq(quizAttempts.profileId, profileId), isNotNull(quizAttempts.completedAt)))
    .orderBy(desc(quizAttempts.completedAt))
    .limit(1);
  if (!row || !row.completedAt) return null;
  return { ...row, completedAt: row.completedAt };
}

// A specific, real congratulation is only worth including if the attempt
// is recent enough to actually be "news" to the child opening chat today -
// referencing a quiz from three weeks ago as if it just happened would
// read as strange, not warm. A generic (still real, just not
// attempt-specific) welcome is used instead once progress is this stale.
const RECENT_ENOUGH_DAYS = 3;

function buildTemplateGreeting(profileName: string, recent: RecentProgress | null): string {
  const invite =
    "Ask me about anything you're working on, or say the word if you'd like to play instead - " +
    "I've got riddles, jokes, tongue twisters, and tricky puzzles!";

  if (recent && Date.now() - recent.completedAt.getTime() <= RECENT_ENOUGH_DAYS * 24 * 60 * 60 * 1000) {
    const accuracy =
      recent.score !== null && recent.totalQuestions > 0 ? Math.round((recent.score / recent.totalQuestions) * 100) : null;
    const praise =
      accuracy !== null && accuracy >= 70
        ? `${accuracy}% on your last ${recent.subjectName} quiz - that's brilliant!`
        : `you cleared ${recent.stagesCleared} stage${recent.stagesCleared === 1 ? "" : "s"} in ${recent.subjectName} recently - nice work sticking with it!`;
    return `Hi ${profileName}! Welcome back - I saw ${praise} ${invite}`;
  }
  return `Hi ${profileName}! Welcome to your Study Buddy chat. ${invite}`;
}

function buildGreetingPrompt(profileName: string, recent: RecentProgress | null): string {
  const progressLine =
    recent && Date.now() - recent.completedAt.getTime() <= RECENT_ENOUGH_DAYS * 24 * 60 * 60 * 1000
      ? `Real recent progress data to (optionally) reference: in ${recent.subjectName}, they cleared ` +
        `${recent.stagesCleared} stage(s)` +
        (recent.score !== null ? ` and scored ${recent.score}/${recent.totalQuestions}` : "") +
        ` a few days ago or less.`
      : "No recent progress data to reference - do not invent any.";

  return [
    "You are Sage the Owl, the warm Study Buddy inside Puzzle Kingdom, an app that helps a child " +
      `(age 7-8) revise Maths and English. Write ONE short opening chat message (2-3 sentences, no ` +
      `markdown) to greet ${profileName} as they open a new chat with you.`,
    progressLine,
    "If there is real progress data above, naturally and specifically congratulate them on it - never " +
      "invent a subject, score, or detail beyond what's given. If there is none, just a warm generic " +
      "welcome, no fabricated specifics.",
    "End by inviting them to either ask about their lessons, OR ask you for a riddle, joke, tongue " +
      "twister, or tricky puzzle if they'd rather play. Warm, natural, conversational tone - like a " +
      "friend saying hello, not a formal announcement.",
  ].join("\n");
}

/**
 * Never throws - a Gemini failure here degrades to buildTemplateGreeting
 * (still real-data-grounded, just fixed phrasing), same "never break the
 * child-facing chat" discipline as tutorGeneration.ts. One retry only
 * (matching tutorIntent.ts's own low-latency reasoning) since this is on
 * the critical path of starting a chat.
 */
export async function buildGreeting(params: { profileId: string; profileName: string }): Promise<string> {
  const { profileId, profileName } = params;
  const recent = await getMostRecentProgress(profileId);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await getGeminiClient().models.generateContent({
        model: env.GEMINI_TUTOR_MODEL,
        contents: [{ text: buildGreetingPrompt(profileName, recent) }],
      });
      const text = response.text?.trim();
      if (!text) throw new Error("Gemini returned no text for a tutor greeting.");
      return text;
    } catch (err) {
      if (attempt === 0 && isRetryableStatus(err)) continue;
      console.warn("Tutor greeting generation failed - falling back to a template greeting:", err);
      return buildTemplateGreeting(profileName, recent);
    }
  }
  return buildTemplateGreeting(profileName, recent);
}
