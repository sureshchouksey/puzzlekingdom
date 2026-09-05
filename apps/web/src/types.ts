// Shapes mirrored from the apps/api responses - kept here rather than a
// shared package for now, since this is still a small two-app MVP.

export type Subject = {
  id: string;
  name: string;
};

export type PkClass = {
  id: string;
  name: string;
};

// A lightweight named player - no password, no login. "Who's playing" is
// picked from a list (or created) at the Welcome screen.
export type Profile = {
  id: string;
  name: string;
  title: string | null;
};

export type QuizOption = {
  id: string;
  text: string;
};

export type QuizQuestion = {
  id: string;
  questionText: string;
  options: QuizOption[];
  documentId: string;
  // The shared reading passage/story this question refers back to, when
  // it came from a comprehension-style document (e.g. English papers).
  // Null for self-contained questions with no passage (e.g. Maths).
  passage: string | null;
  // Free-text topic tags on this question (e.g. ["Fractions", "Word
  // Problems"]) - null for content not yet topic-tagged.
  topics: string[] | null;
};

export type AssembleQuizResponse = {
  attemptId: string;
  subjectName: string;
  // Added for Section 10 step 7 ("Explain this to me") - lets the Quiz
  // screen start a question-scoped Study Buddy conversation without a
  // second lookup. classId can be null in principle (the backend route
  // itself doesn't require one), but the app's own UI always supplies one
  // via SubjectPicker, so in practice this is always set here.
  subjectId: string;
  classId: string | null;
  // How many questions make up one stage of this attempt, and how many
  // stages the quiz is broken into in total (Math.ceil(questions.length /
  // stageSize)) - the frontend chunks `questions` into stages positionally
  // using these two numbers, matching how the backend counts stages.
  stageSize: number;
  totalStages: number;
  questions: QuizQuestion[];
};

// Per-question review for one stage's worth of answers - what was picked,
// what was actually correct, the explanation, and (only when wrong) the
// memorable tip. Same shape the final Results screen uses (ResultsAnswer
// below), just without the passage/document fields since the stage report
// doesn't re-show the passage.
export type StageAnswerReview = {
  questionId: string;
  questionText: string;
  options: QuizOption[];
  selectedOptionId: string;
  correctOptionId: string;
  explanation: string;
  tip: string | null;
  isCorrect: boolean;
};

// Response from submitting one stage's worth of answers. `score` /
// `totalQuestions` / `topicBreakdown` are only present once the final
// stage has been submitted (isComplete: true) - the whole attempt is
// scored cumulatively at that point, not per stage. `answers` is always
// this stage's own per-question review, in the order they were submitted.
// `passed` is false when the stage fell short of `passThreshold` (0.7,
// i.e. 70%) - in that case none of this stage's answers were recorded,
// stagesCleared didn't move, and isComplete is always false: the same
// stage has to be retried before the quiz can continue.
export type SubmitStageResponse = {
  attemptId: string;
  stagesCleared: number;
  totalStages: number;
  stageScore: number;
  stageTotal: number;
  isComplete: boolean;
  passed: boolean;
  passThreshold: number;
  answers: StageAnswerReview[];
  score?: number;
  totalQuestions?: number;
  topicBreakdown?: Record<string, { correct: number; total: number }>;
};

export type ResultsAnswer = {
  questionId: string;
  questionText: string | null;
  options: QuizOption[];
  selectedOptionId: string;
  correctOptionId: string | null;
  explanation: string | null;
  // The memorable trick/strategy for this question - only populated for a
  // wrong answer (see apps/api/src/routes/quizzes.ts's /results handler).
  tip: string | null;
  isCorrect: boolean;
  documentId: string | null;
  passage: string | null;
};

export type QuizResults = {
  attemptId: string;
  subjectName: string | null;
  // Same reason as AssembleQuizResponse above - Section 10 step 7.
  subjectId: string;
  classId: string | null;
  className: string | null;
  profileName: string | null;
  score: number | null;
  totalQuestions: number;
  stageSize: number;
  totalStages: number;
  stagesCleared: number;
  completedAt: string;
  answers: ResultsAnswer[];
};

export type UploadDocumentResponse = {
  id: string;
  status: string;
};

export type AiProvider = "claude" | "gemini";

export type ProviderCostEstimate = {
  provider: AiProvider;
  model: string;
  available: boolean;
  reason?: string;
  requestedQuestionCount: number;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  estimatedCostUsd?: number;
};

export type EstimateResponse = {
  documentId: string;
  requestedQuestionCount: number;
  estimates: ProviderCostEstimate[];
};

export type GenerateResponse = {
  status: string;
  questionCount: number;
  provider: string;
};

export type ApiErrorBody = {
  error: string;
};

export type ManualQuestionInput = {
  questionText: string;
  options: QuizOption[];
  correctOptionId: string;
  explanation: string;
};

export type SaveManualQuestionsParams = {
  subjectName: string;
  filename?: string;
  passage?: string;
  questions: ManualQuestionInput[];
};

export type SaveManualQuestionsResponse = {
  status: string;
  questionCount: number;
  documentId: string;
};

// Aggregated accuracy for one topic tag across every matching completed
// quiz attempt (not just the most recent one) - sorted weakest-first by
// the API, since the point is showing what to focus on next.
export type TopicReport = {
  topic: string;
  correct: number;
  total: number;
  accuracy: number | null;
  attempts: number;
};

// One row of quiz history - a completed attempt plus the topic-accuracy
// snapshot that was saved for it at submit time.
export type AttemptReport = {
  id: string;
  subjectName: string;
  className: string | null;
  score: number | null;
  totalQuestions: number;
  completedAt: string;
  topicBreakdown: Record<string, { correct: number; total: number }> | null;
};

// One ranked row on the leaderboard - a profile's total progress, summed
// across every quiz attempt (completed or still in progress) matching the
// filter, sorted by the API with the most stages cleared first.
export type LeaderboardEntry = {
  profileId: string;
  name: string;
  title: string | null;
  quizzesPlayed: number;
  stagesCleared: number;
  questionsAnswered: number;
  questionsCorrect: number;
  accuracy: number | null;
};

// Returned alongside a Profile once a session is actually issued (after
// the PIN step succeeds) - the token proves "you are this profile" on
// every later request. See apps/api/src/auth.ts.
export type ProfileSessionResponse = {
  profile: Profile;
  token: string;
};

// Returned by find-or-create (POST /profiles) - no session yet, just
// enough for the Welcome screen to decide which PIN step to show next:
// "created" means this name didn't exist before this call, "hasPin" says
// whether set-pin or verify-pin is the right next step.
export type ProfileLookupResponse = Profile & {
  created: boolean;
  hasPin: boolean;
};

// A real administrator account - username + password, stored in the
// database, distinct from the passwordless player profiles above.
export type AdminUser = {
  id: string;
  username: string;
};

export type AdminLoginResponse = {
  admin: AdminUser;
  token: string;
};

// One question row as shown in the admin dashboard's question list -
// AdminQuestion carries the same fields plus subject/class context and
// timestamps, since it's read from a joined query.
export type AdminQuestion = {
  id: string;
  questionText: string;
  options: QuizOption[];
  correctOptionId: string;
  explanation: string;
  topics: string[] | null;
  tip: string | null;
  documentId: string;
  subjectName: string;
  className: string | null;
  createdAt: string;
};

export type AdminQuestionsResponse = {
  questions: AdminQuestion[];
  nextCursor: string | null;
};

// Body for creating or editing a question from the admin dashboard - every
// field optional except documentId (required only when creating), since an
// edit only sends the fields that changed.
export type AdminQuestionWriteInput = {
  documentId?: string;
  questionText?: string;
  options?: QuizOption[];
  correctOptionId?: string;
  explanation?: string;
  topics?: string[];
  tip?: string;
};

// One row of the admin "Users" roster - every profile with aggregate
// stats, not just the ones who've played (unlike the public leaderboard).
export type AdminUserSummary = {
  profileId: string;
  name: string;
  title: string | null;
  createdAt: string;
  hasPin: boolean;
  quizzesPlayed: number;
  stagesCleared: number;
  questionsAnswered: number;
  questionsCorrect: number;
  accuracy: number | null;
  lastActive: string | null;
};

// The AI Study Mentor ("Study Buddy") - see plan/AI-Study-Mentor-Agent-Plan.md,
// Section 9/10. A conversation is scoped to one class+subject for its
// whole lifetime (set once at creation, see POST /tutor/conversations).
export type TutorContextType = "general" | "question";

export type TutorConversation = {
  id: string;
  profileId: string;
  classId: string;
  subjectId: string;
  startedAt: string;
  lastMessageAt: string;
  contextType: TutorContextType;
  relatedQuestionId: string | null;
  relatedAttemptId: string | null;
  // Only present on GET /tutor/conversations and GET
  // /tutor/conversations/:id (Section 10 step 9's admin conversation
  // browser) - absent on the plain row POST /tutor/conversations
  // returns when starting/resuming one.
  subjectName?: string;
  className?: string;
};

export type TutorMessageRole = "student" | "agent";

// One turn in the transcript, as stored - createdAt lets the UI order a
// freshly-loaded conversation correctly.
export type TutorMessage = {
  role: TutorMessageRole;
  content: string;
  createdAt: string;
};

export type TutorTranscript = {
  conversation: TutorConversation;
  messages: TutorMessage[];
};

// What POST /tutor/conversations/:id/messages actually returns for one
// student message: "ai"/"template" are real replies (grounded vs. honest
// fallback - see tutorGeneration.ts), "blocked" means the budget check
// stopped it before retrieval/generation ever ran (see `reason`).
export type TutorMessageMode = "ai" | "template" | "blocked";

export type TutorMessageResponse = {
  mode: TutorMessageMode;
  reason?: "daily_cap_reached" | "tutor_disabled";
  reply: string;
};

// What's needed to start a question-scoped Study Buddy conversation from
// one specific wrong answer - Quiz's stage report or Results (Section 10
// step 7). subjectName is carried along purely for display in the chat
// screen's title/heading; starting the conversation itself only needs
// classId/subjectId/questionId (see POST /tutor/conversations).
export type TutorQuestionContext = {
  classId: string;
  subjectId: string;
  subjectName: string;
  questionId: string;
  questionText: string;
  attemptId: string;
};

// Doubt tracking + growth insights (Section 10 step 8) - admin-only for
// now (Section 12's "should this ever surface to the child" question is
// still open). topicCounts/ungroundedCount/totalAgentReplies are a live
// aggregation, not stored anywhere themselves; the insights array is
// what's actually persisted in tutor_growth_insights.
export type TutorDoubtBreakdown = {
  topicCounts: { topic: string; count: number }[];
  ungroundedCount: number;
  totalAgentReplies: number;
};

export type TutorGrowthInsight = {
  id: string;
  profileId: string;
  topic: string;
  insightText: string;
  generatedAt: string;
};

export type TutorInsightsResponse = {
  breakdown: TutorDoubtBreakdown;
  insights: TutorGrowthInsight[];
};

export type GenerateInsightsResponse =
  | { generated: true; insights: TutorGrowthInsight[] }
  | { generated: false; reason: "not_enough_activity" };

// The admin-only Study Buddy settings toggle/caps (Section 10 step 9) -
// mirrors apps/api/src/services/tutorBudget.ts's own AppSettings shape.
export type TutorSettings = {
  tutorEnabled: boolean;
  tutorDailyCapPerProfile: number;
  tutorSharedDailyBudget: number | null;
};
