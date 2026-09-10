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
  // Which of the 5 per-title avatars was picked (e.g. "prince-3") - null
  // for profiles created before avatar choice existed. See Welcome.tsx.
  avatarId: string | null;
};

export type QuizOption = {
  id: string;
  text: string;
};

// One misspelled word flagged in a short/long answer, with nspell's own
// suggested corrections - see apps/api/src/lib/spellcheck.ts.
export type SpellingIssue = {
  word: string;
  suggestions: string[];
};

// What the player actually submits for one non-mcq/true_false question -
// a typed string for fill_blank/missing_number/missing_spelling/short_
// answer/long_answer, or the pairs built for match_column ([leftIndex,
// rightIndex] per pair). Mirrors apps/api/src/lib/scoring.ts's
// SubmittedAnswer.selectedPayload shape.
export type SelectedPayload = {
  text?: string;
  pairs?: [number, number][];
};

export type QuizQuestion = {
  id: string;
  questionText: string;
  questionType: QuestionType;
  // mcq/true_false only - empty for every other type (see api.ts's
  // assembleQuiz/resumeQuiz and the backend's own assemblyAnswerPayload,
  // which strips out the actual answer for the other 6 types).
  options: QuizOption[];
  // Only ever set for match_column ({left, right} - the two lists to
  // build pairs from), and even then never carries correctPairs - see
  // apps/api/src/routes/quizzes.ts's assemblyAnswerPayload for exactly
  // what's withheld and why, same spoiler concern as correctOptionId.
  answerPayload: AnswerPayload | null;
  imageUrl: string | null;
  documentId: string;
  // The shared reading passage/story this question refers back to, when
  // it came from a comprehension-style document (e.g. English papers).
  // Null for self-contained questions with no passage (e.g. Maths).
  passage: string | null;
  // Free-text topic tags on this question (e.g. ["Fractions", "Word
  // Problems"]) - null for content not yet topic-tagged.
  topics: string[] | null;
};

// The Arcade's 5 games (see plan/Question-Types-and-Content-Authoring-Plan.md
// "Practice games (the Arcade)" and apps/api/src/routes/games.ts's
// GAME_DEFINITIONS, which this mirrors exactly).
export type GameKey =
  | "spelling_sprint"
  | "missing_letters"
  | "word_meaning_match"
  | "homophone_hunter"
  | "prefix_suffix_builder";

// One question as returned by GET /games/round - deliberately carries the
// FULL answer key (correctOptionId / answerPayload, not stripped the way
// QuizQuestion's is), because Arcade rounds grade themselves instantly in
// the browser rather than round-tripping to the server per question - see
// the comment on that route for why this is a safe, intentional
// difference from the graded quiz's spoiler-withholding rule.
export type GameQuestion = {
  id: string;
  questionText: string;
  questionType: QuestionType;
  options: QuizOption[];
  correctOptionId: string | null;
  answerPayload: AnswerPayload | null;
  imageUrl: string | null;
};

export type GameRoundResponse = {
  game: GameKey;
  questions: GameQuestion[];
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
  // Only set when this quiz came back from resumeQuiz() (api.ts) rather
  // than assembleQuiz() - how many stages were already cleared on a
  // previous visit, so Quiz.tsx can skip straight past them instead of
  // restarting at stage 1. Undefined (treated as 0) for a fresh quiz.
  stagesCleared?: number;
  questions: QuizQuestion[];
};

// One step in a "Quest Journey" - a single subject+topic pair the
// player can play as an isolated, single-stage quiz. Built client-side
// in SubjectPicker.tsx from getTopics/getTopicReports; nothing new is
// stored on the backend for this part.
export type QuestJourneyItem = { subjectName: string; topic: string };

// Tracks progress through a Quest Journey across the Quiz and Results
// screens, so Results can offer "next quest" and jump straight into the
// next topic's quiz without routing back through SubjectPicker.
export type QuestJourney = {
  pkClass: PkClass;
  items: QuestJourneyItem[];
  index: number;
};

// Per-question review for one stage's worth of answers - what was picked,
// what was actually correct, the explanation, and (only when wrong) the
// memorable tip. Same shape the final Results screen uses (ResultsAnswer
// below), just without the passage/document fields since the stage report
// doesn't re-show the passage.
export type StageAnswerReview = {
  questionId: string;
  questionText: string;
  questionType: QuestionType;
  options: QuizOption[];
  // Set for mcq/true_false; null for every other type, which answers via
  // selectedPayload instead.
  selectedOptionId: string | null;
  selectedPayload: unknown;
  correctOptionId: string;
  // Unlike QuizQuestion.answerPayload above, this is the FULL payload
  // (including acceptedAnswers/correctPairs/rubricKeyPoints) - safe here
  // since the question has already been answered and this is the review.
  answerPayload: AnswerPayload | null;
  explanation: string;
  tip: string | null;
  isCorrect: boolean;
  // Null for short_answer/long_answer (excluded from scoring - see
  // apps/api/src/lib/scoring.ts); a fraction (0-1) for match_column's
  // partial credit; exactly 0 or 1 for every other graded type.
  score: number | null;
  // Only ever set for short_answer/long_answer.
  spellingIssues: SpellingIssue[] | null;
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
  questionType: QuestionType;
  options: QuizOption[];
  selectedOptionId: string | null;
  selectedPayload: unknown;
  correctOptionId: string | null;
  answerPayload: AnswerPayload | null;
  explanation: string | null;
  // The memorable trick/strategy for this question - only populated for a
  // wrong answer (see apps/api/src/routes/quizzes.ts's /results handler).
  tip: string | null;
  isCorrect: boolean;
  score: number | null;
  spellingIssues: SpellingIssue[] | null;
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
  avatarId: string | null;
  quizzesPlayed: number;
  stagesCleared: number;
  // The ranking metric (Question-Types-and-Content-Authoring-Plan.md's
  // "Competitive framing" section) - summed across every quiz attempt's
  // stars_earned. Entries already arrive sorted by this, highest first.
  starsEarned: number;
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

// The 8 question types from Question-Types-and-Content-Authoring-Plan.md.
// mcq/true_false keep using options/correctOptionId; every other type
// stores its answer shape in answerPayload instead - see AnswerPayload
// below for exactly what each type holds there.
export type QuestionType =
  | "mcq"
  | "true_false"
  | "fill_blank"
  | "missing_number"
  | "missing_spelling"
  | "match_column"
  | "short_answer"
  | "long_answer";

// The answerPayload shapes lib/scoring.ts (apps/api) grades against -
// kept as one loose union here rather than importing from the API, since
// the two apps don't share a package yet (see types.ts's own header
// comment). Optional fields throughout since a row not yet saved (a
// fresh admin draft) or an mcq/true_false row (answerPayload is null)
// won't have any of these set.
export type AnswerPayload = {
  acceptedAnswers?: string[];
  left?: string[];
  right?: string[];
  correctPairs?: [number, number][];
  rubricKeyPoints?: string[];
};

// One question row as shown in the admin dashboard's question list -
// AdminQuestion carries the same fields plus subject/class context and
// timestamps, since it's read from a joined query.
export type AdminQuestion = {
  id: string;
  questionText: string;
  questionType: QuestionType;
  options: QuizOption[];
  correctOptionId: string;
  answerPayload: AnswerPayload | null;
  imageUrl: string | null;
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
  questionType?: QuestionType;
  questionText?: string;
  options?: QuizOption[];
  correctOptionId?: string;
  answerPayload?: AnswerPayload | null;
  imageUrl?: string;
  explanation?: string;
  topics?: string[];
  tip?: string;
};

// One topic row (schema.ts's topics table) - class+subject scoped,
// ordered, with a difficulty tag. Managed from the admin dashboard's
// Topics tab; consumed by the quest map (via /reports/topics) for its
// node sequence and difficulty labels.
export type TopicDifficulty = "beginner" | "medium" | "hard";

export type AdminTopic = {
  id: string;
  classId: string;
  subjectId: string;
  name: string;
  displayOrder: number;
  difficulty: TopicDifficulty;
  createdAt: string;
  className: string;
  subjectName: string;
};

export type AdminTopicWriteInput = {
  classId?: string;
  subjectId?: string;
  name?: string;
  displayOrder?: number;
  difficulty?: TopicDifficulty;
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
  // Only present in the response to POST /tutor/conversations, and only
  // when that call actually created a brand-new conversation (never on
  // resume) - see tutorProgress.ts's buildGreeting. A warm, progress-aware
  // opening line the child hasn't seen yet, meant to be shown as the very
  // first chat bubble.
  greeting?: string;
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
// student message: "ai" is a real Gemini-generated reply, "grounded" is
// real matched content (a concept guide or question explanation) served
// directly because Gemini itself failed (or the "Gemini" toggle is off,
// see tutorGeneration.ts), "template" is the honest "I don't know"
// fallback for a genuine non-match. "cached" is a previous real "ai"
// reply to this same question reused via the "Cache" toggle
// (tutorBudget.ts's getCachedReply), costing no new Gemini call.
// "blocked" means the budget/toggle check stopped the message before
// retrieval/generation ever ran (see `reason`).
export type TutorMessageMode = "ai" | "template" | "grounded" | "blocked" | "cached";

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
  // Track 2's three-way Resource Access toggle, ported from the Custom
  // Gemini reference prototype - each independently switchable.
  tutorUseConceptGuides: boolean;
  tutorUseCache: boolean;
  tutorUseGemini: boolean;
};
