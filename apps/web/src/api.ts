import type {
  AiProvider,
  AssembleQuizResponse,
  EstimateResponse,
  GenerateResponse,
  QuizResults,
  Subject,
  SubmitQuizResponse,
  UploadDocumentResponse,
} from "./types";

// All calls go through /api, which vite's dev-server proxy (see
// vite.config.ts) forwards to the Fastify backend with the /api prefix
// stripped - so this file never needs to know the backend's real port.
const BASE = "/api";

async function asJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : res.statusText;
    throw new Error(message);
  }
  return body as T;
}

export function getSubjects(): Promise<Subject[]> {
  return fetch(`${BASE}/subjects`).then((res) => asJson(res));
}

export function uploadDocument(params: { file: File; subjectName: string }): Promise<UploadDocumentResponse> {
  const formData = new FormData();
  formData.append("subject", params.subjectName);
  formData.append("file", params.file);
  return fetch(`${BASE}/documents`, { method: "POST", body: formData }).then((res) => asJson(res));
}

export function estimateGeneration(params: { documentId: string; count: number }): Promise<EstimateResponse> {
  return fetch(`${BASE}/documents/${params.documentId}/estimate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count: params.count }),
  }).then((res) => asJson(res));
}

export function generateQuestions(params: {
  documentId: string;
  provider: AiProvider;
  count: number;
}): Promise<GenerateResponse> {
  return fetch(`${BASE}/documents/${params.documentId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: params.provider, count: params.count }),
  }).then((res) => asJson(res));
}

export function assembleQuiz(params: { subjectName: string; count: number }): Promise<AssembleQuizResponse> {
  return fetch(`${BASE}/quizzes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }).then((res) => asJson(res));
}

export function submitQuiz(params: {
  attemptId: string;
  answers: { questionId: string; selectedOptionId: string }[];
}): Promise<SubmitQuizResponse> {
  return fetch(`${BASE}/quizzes/${params.attemptId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: params.answers }),
  }).then((res) => asJson(res));
}

export function getResults(attemptId: string): Promise<QuizResults> {
  return fetch(`${BASE}/quizzes/${attemptId}/results`).then((res) => asJson(res));
}
