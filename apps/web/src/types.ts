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
  // How many questions make up one stage of this attempt, and how many
  // stages the quiz is broken into in total (Math.ceil(questions.length /
  // stageSize)) - the frontend chunks `questions` into stages positionally
  // using these two numbers, matching how the backend counts stages.
  stageSize: number;
  totalStages: number;
  questions: QuizQuestion[];
};

// Response from submitting one stage's worth of answers. `score` /
// `totalQuestions` / `topicBreakdown` are only present once the final
// stage has been submitted (isComplete: true) - the whole attempt is
// scored cumulatively at that point, not per stage.
export type SubmitStageResponse = {
  attemptId: string;
  stagesCleared: number;
  totalStages: number;
  stageScore: number;
  stageTotal: number;
  isComplete: boolean;
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
  isCorrect: boolean;
  documentId: string | null;
  passage: string | null;
};

export type QuizResults = {
  attemptId: string;
  subjectName: string | null;
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
