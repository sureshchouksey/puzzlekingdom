import type {
  AdminLoginResponse,
  AdminQuestion,
  AdminQuestionsResponse,
  AdminQuestionWriteInput,
  AdminUserSummary,
  AiProvider,
  AssembleQuizResponse,
  AttemptReport,
  EstimateResponse,
  GenerateResponse,
  LeaderboardEntry,
  PkClass,
  ProfileLookupResponse,
  ProfileSessionResponse,
  QuizResults,
  SaveManualQuestionsParams,
  SaveManualQuestionsResponse,
  Subject,
  SubmitStageResponse,
  TopicReport,
  TutorConversation,
  TutorMessageResponse,
  TutorTranscript,
  TutorInsightsResponse,
  GenerateInsightsResponse,
  TutorSettings,
  UploadDocumentResponse,
} from "./types";

// In local/LAN dev, calls go through /api, which vite's dev-server proxy
// (see vite.config.ts) forwards to the Fastify backend with the /api
// prefix stripped. In a deployed build (Vercel), the frontend and API run
// on different domains, so VITE_API_BASE_URL is set at build time to the
// API's real URL (e.g. "https://puzzlekingdom-api.onrender.com", no /api
// suffix - the backend's own routes live at the root, not behind /api).
const BASE = import.meta.env.VITE_API_BASE_URL || "/api";

// The shared family passcode, entered once at the Gate screen and reused
// on every request from then on. Only meaningful once the deployed API
// has APP_PASSCODE configured - see apps/api/src/index.ts. Local dev never
// prompts for one, so this just stays empty and the header below is a
// harmless no-op.
export const PASSCODE_STORAGE_KEY = "pk_passcode";

export function getStoredPasscode(): string | null {
  try {
    return localStorage.getItem(PASSCODE_STORAGE_KEY);
  } catch {
    return null;
  }
}

// One stored session token, whichever flow (profile session or admin
// login) last succeeded - see apps/api/src/auth.ts. Cleared on logout().
const AUTH_TOKEN_STORAGE_KEY = "pk_auth_token";

export function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setAuthToken(token: string): void {
  try {
    localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore - session just won't persist across a reload
  }
}

// Clears the stored session token - "log out" for either a profile or an
// admin. Doesn't touch the shared passcode, which stays entered.
export function logout(): void {
  try {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const passcode = getStoredPasscode();
  const token = getAuthToken();
  const headers = new Headers(init.headers);
  if (passcode) headers.set("x-app-passcode", passcode);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${BASE}${path}`, { ...init, headers });
}

// Called by the Gate screen after the visitor types a passcode (already
// saved to localStorage by the caller) - true if the API accepts it.
export function checkPasscode(): Promise<boolean> {
  return apiFetch("/auth/check").then((res) => res.ok);
}

async function asJson<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : res.statusText;
    throw new Error(message);
  }
  return body as T;
}

export function getSubjects(): Promise<Subject[]> {
  return apiFetch(`/subjects`).then((res) => asJson(res));
}

// Find-or-create by name (case-insensitive on the server) - safe to call
// every time someone "enters the kingdom" with a name, whether they're new
// or returning. Never issues a session by itself - see setProfilePin /
// verifyProfilePin below, which is what the Welcome screen calls next
// depending on this response's `hasPin`.
export function lookupProfile(name: string): Promise<ProfileLookupResponse> {
  return apiFetch(`/profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).then((res) => asJson(res));
}

// One-time PIN bootstrap for a profile that doesn't have one yet (brand
// new, or created before PINs existed). `title` is only meaningful the
// very first time (a genuinely new profile) - the server ignores it if
// the profile already has a title. Stores the returned token itself.
export function setProfilePin(profileId: string, params: { pin: string; title?: string }): Promise<ProfileSessionResponse> {
  return apiFetch(`/profiles/${profileId}/set-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
    .then((res) => asJson<ProfileSessionResponse>(res))
    .then((data) => {
      setAuthToken(data.token);
      return data;
    });
}

// Normal login for a profile that already has a PIN. Stores the returned
// token itself.
export function verifyProfilePin(profileId: string, pin: string): Promise<ProfileSessionResponse> {
  return apiFetch(`/profiles/${profileId}/verify-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  })
    .then((res) => asJson<ProfileSessionResponse>(res))
    .then((data) => {
      setAuthToken(data.token);
      return data;
    });
}

export function getClasses(): Promise<PkClass[]> {
  return apiFetch(`/classes`).then((res) => asJson(res));
}

export function getClassSubjects(classId: string): Promise<Subject[]> {
  return apiFetch(`/classes/${classId}/subjects`).then((res) => asJson(res));
}

export function getTopics(params: { classId?: string; subjectName?: string }): Promise<string[]> {
  const query = new URLSearchParams();
  if (params.classId) query.set("classId", params.classId);
  if (params.subjectName) query.set("subjectName", params.subjectName);
  const qs = query.toString();
  return apiFetch(`/topics${qs ? `?${qs}` : ""}`).then((res) => asJson(res));
}

export function uploadDocument(params: { file: File; subjectName: string }): Promise<UploadDocumentResponse> {
  const formData = new FormData();
  formData.append("subject", params.subjectName);
  formData.append("file", params.file);
  return apiFetch(`/documents`, { method: "POST", body: formData }).then((res) => asJson(res));
}

export function estimateGeneration(params: { documentId: string; count: number }): Promise<EstimateResponse> {
  return apiFetch(`/documents/${params.documentId}/estimate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count: params.count }),
  }).then((res) => asJson(res));
}

export function generateQuestions(params: {
  documentId: string;
  provider: AiProvider;
  count?: number;
}): Promise<GenerateResponse> {
  return apiFetch(`/documents/${params.documentId}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: params.provider, count: params.count }),
  }).then((res) => asJson(res));
}

export function assembleQuiz(params: {
  subjectName: string;
  classId?: string;
  topic?: string;
  count?: number;
  profileId?: string;
  stageSize?: number;
}): Promise<AssembleQuizResponse> {
  return apiFetch(`/quizzes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }).then((res) => asJson(res));
}

// Submits one stage's worth of answers at a time, not necessarily the
// whole quiz - see SubmitStageResponse. Call again with the next stage's
// answers to continue; the response says whether the attempt is complete.
export function submitStage(params: {
  attemptId: string;
  answers: { questionId: string; selectedOptionId: string }[];
}): Promise<SubmitStageResponse> {
  return apiFetch(`/quizzes/${params.attemptId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers: params.answers }),
  }).then((res) => asJson(res));
}

export function getResults(attemptId: string): Promise<QuizResults> {
  return apiFetch(`/quizzes/${attemptId}/results`).then((res) => asJson(res));
}

export function saveManualQuestions(params: SaveManualQuestionsParams): Promise<SaveManualQuestionsResponse> {
  return apiFetch(`/documents/manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }).then((res) => asJson(res));
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `?${qs}` : "";
}

export function getReports(params: { classId?: string; subjectName?: string; limit?: number } = {}): Promise<AttemptReport[]> {
  return apiFetch(`/reports${buildQuery(params)}`).then((res) => asJson(res));
}

export function getTopicReports(params: { classId?: string; subjectName?: string } = {}): Promise<TopicReport[]> {
  return apiFetch(`/reports/topics${buildQuery(params)}`).then((res) => asJson(res));
}

export function getLeaderboard(params: { classId?: string } = {}): Promise<LeaderboardEntry[]> {
  return apiFetch(`/leaderboard${buildQuery(params)}`).then((res) => asJson(res));
}

// Real admin login - username + password, unlike the passwordless
// profiles. Stores the returned token itself, so callers don't need to.
export function adminLogin(params: { username: string; password: string }): Promise<AdminLoginResponse> {
  return apiFetch(`/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
    .then((res) => asJson<AdminLoginResponse>(res))
    .then((data) => {
      setAuthToken(data.token);
      return data;
    });
}

export function getAdminQuestions(
  params: { subjectName?: string; classId?: string; search?: string; limit?: number; cursor?: string } = {}
): Promise<AdminQuestionsResponse> {
  return apiFetch(`/admin/questions${buildQuery(params)}`).then((res) => asJson(res));
}

export function createAdminQuestion(input: AdminQuestionWriteInput): Promise<AdminQuestion> {
  return apiFetch(`/admin/questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => asJson(res));
}

export function updateAdminQuestion(id: string, input: AdminQuestionWriteInput): Promise<AdminQuestion> {
  return apiFetch(`/admin/questions/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => asJson(res));
}

export async function deleteAdminQuestion(id: string): Promise<void> {
  const res = await apiFetch(`/admin/questions/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : res.statusText;
    throw new Error(message);
  }
}

export function getAdminUsers(): Promise<AdminUserSummary[]> {
  return apiFetch(`/admin/users`).then((res) => asJson(res));
}

// Forgot-PIN recovery - clears a profile's PIN so it's prompted to choose
// a new one next time it's entered on the Welcome screen.
export async function resetProfilePin(profileId: string): Promise<void> {
  const res = await apiFetch(`/admin/users/${profileId}/reset-pin`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : res.statusText;
    throw new Error(message);
  }
}

// Starts or resumes a Study Buddy conversation - profile-scoped, see
// POST /tutor/conversations. classId/subjectId fix the conversation's
// scope for its whole lifetime; contextType defaults to "general" (the
// Home entry point) - "question" (the "Explain this to me" entry point)
// isn't wired up on the frontend yet.
export function startTutorConversation(params: {
  classId: string;
  subjectId: string;
  contextType?: "general" | "question";
  questionId?: string;
  attemptId?: string;
}): Promise<TutorConversation> {
  return apiFetch(`/tutor/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }).then((res) => asJson(res));
}

// One chat turn - the reply already reflects budget/toggle enforcement
// (mode: "blocked") as well as grounded vs. honest-fallback replies
// (mode: "ai" | "template") - see tutor.ts's own comments for what each
// mode means and why they're kept distinct.
export function sendTutorMessage(conversationId: string, message: string): Promise<TutorMessageResponse> {
  return apiFetch(`/tutor/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  }).then((res) => asJson(res));
}

// Full transcript for one conversation - used to restore history when
// resuming today's chat rather than starting the UI from a blank slate.
export function getTutorConversation(id: string): Promise<TutorTranscript> {
  return apiFetch(`/tutor/conversations/${id}`).then((res) => asJson(res));
}

// Doubt tracking + growth insights for one profile (Section 10 step 8,
// admin-only). GET is cheap/safe to call anytime - it's a live
// aggregation plus whatever's already been generated; the generate call
// is the one that actually costs a Gemini call and writes new insights.
export function getTutorInsights(profileId: string): Promise<TutorInsightsResponse> {
  return apiFetch(`/admin/users/${profileId}/tutor-insights`).then((res) => asJson(res));
}

export function generateTutorInsights(profileId: string): Promise<GenerateInsightsResponse> {
  return apiFetch(`/admin/users/${profileId}/tutor-insights/generate`, { method: "POST" }).then((res) => asJson(res));
}

// The Study Buddy on/off toggle + caps (Section 10 step 9) - reads/writes
// the same app_settings singleton tutorBudget.ts checks on every chat
// turn. updateTutorSettings sends whichever fields the settings form
// currently holds - PATCH merges onto the existing row either way, so
// sending all three every save is simplest and still correct.
export function getTutorSettings(): Promise<TutorSettings> {
  return apiFetch(`/admin/settings`).then((res) => asJson(res));
}

export function updateTutorSettings(patch: Partial<TutorSettings>): Promise<TutorSettings> {
  return apiFetch(`/admin/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((res) => asJson(res));
}

// A profile's own conversation list (admin override via ?profileId=) -
// Section 10 step 9's conversation browser. Reuses the same
// TutorConversation shape general chat already uses, now carrying
// subjectName/className for display (see types.ts).
export function getTutorConversationsForProfile(profileId: string): Promise<TutorConversation[]> {
  return apiFetch(`/tutor/conversations?profileId=${profileId}`).then((res) => asJson(res));
}
