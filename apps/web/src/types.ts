// Shapes mirrored from the apps/api responses - kept here rather than a
// shared package for now, since this is still a small two-app MVP.

export type Subject = {
  id: string;
  name: string;
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
};

export type AssembleQuizResponse = {
  attemptId: string;
  subjectName: string;
  questions: QuizQuestion[];
};

export type SubmitQuizResponse = {
  attemptId: string;
  score: number;
  totalQuestions: number;
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
  score: number | null;
  totalQuestions: number;
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
