import type {
  ActivityType,
  AdminLoginResponse,
  AdminMetricsOverview,
  AdminQuestion,
  AdminQuestionsResponse,
  AdminQuestionWriteInput,
  AdminTopic,
  AdminTopicWriteInput,
  AdminUserSummary,
  AiProvider,
  AssembleQuizResponse,
  AttemptReport,
  FamilyFeatureFlags,
  FamilyLoginResponse,
  FamilyMetricsSummary,
  FamilySignupResponse,
  EstimateResponse,
  GameKey,
  GameRoundResponse,
  GenerateResponse,
  LeaderboardEntry,
  MetricsPeriod,
  PkClass,
  Profile,
  ProfileLookupResponse,
  ProfileSessionResponse,
  QuizResults,
  SaveManualQuestionsParams,
  SaveManualQuestionsResponse,
  SelectedPayload,
  Subject,
  SubmitStageResponse,
  TopicReport,
  TutorConversation,
  TutorMessageResponse,
  TutorTranscript,
  TutorInsightsResponse,
  GenerateInsightsResponse,
  AppSettings,
  FeatureFlags,
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
// new, or created before PINs existed). `title`/`avatarId` are only
// meaningful the very first time (a genuinely new profile) - the server
// ignores them if the profile already has a title. Stores the returned
// token itself.
export function setProfilePin(
  profileId: string,
  params: { pin: string; title?: string; avatarId?: string }
): Promise<ProfileSessionResponse> {
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

// Every not-yet-completed attempt for one profile+subject(+class), most
// recently started first - used by SubjectPicker's "Topic Practice" list
// to show "Continue - stage X of Y" instead of "Start" on any topic (or
// the no-filter "mixed practice" option, keyed by topic: null) the player
// left mid-quiz.
export function getQuizInProgress(params: { profileId: string; subjectName: string; classId?: string }): Promise<
  { attemptId: string; topic: string | null; stagesCleared: number; totalStages: number }[]
> {
  return apiFetch(`/quizzes/in-progress${buildQuery(params)}`).then((res) => asJson(res));
}

// Picks up the most recent in-progress attempt for this profile+subject
// (+class)(+topic) exactly where it left off - same response shape as
// assembleQuiz, plus stagesCleared so the Quiz screen can skip straight
// past whatever stages are already cleared instead of restarting at
// stage 1. 404s if there's nothing to resume (caller should fall back to
// assembleQuiz in that case).
export function resumeQuiz(params: { profileId: string; subjectName: string; classId?: string; topic?: string }): Promise<
  AssembleQuizResponse & { stagesCleared: number }
> {
  return apiFetch(`/quizzes/resume${buildQuery(params)}`).then((res) => asJson(res));
}

// Submits one stage's worth of answers at a time, not necessarily the
// whole quiz - see SubmitStageResponse. Call again with the next stage's
// answers to continue; the response says whether the attempt is complete.
export function submitStage(params: {
  attemptId: string;
  answers: { questionId: string; selectedOptionId?: string; selectedPayload?: SelectedPayload }[];
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

// The Arcade - see routes/games.ts. `count` is optional (backend
// defaults to 10, clamped to 30). Unlike assembleQuiz, this doesn't
// create a resumable attempt row - a round is played start to finish in
// one sitting, and only recorded afterward via recordGameAttempt.
export function getGameRound(params: { game: GameKey; classId?: string; subjectName?: string; count?: number }): Promise<GameRoundResponse> {
  return apiFetch(`/games/round${buildQuery(params)}`).then((res) => asJson(res));
}

// Which games have real content for this class+subject right now - see
// routes/games.ts's own comment. Drives the Arcade menu so a game with
// nothing behind it (yet) simply isn't offered, rather than 404ing the
// moment it's tapped.
export function getAvailableGames(params: { classId?: string; subjectName?: string }): Promise<GameKey[]> {
  return apiFetch(`/games/available${buildQuery(params)}`).then((res) => asJson<{ games: GameKey[] }>(res)).then((r) => r.games);
}

// Reports one finished round and returns the stars it earned (same
// star-band as a graded quiz stage - see lib/scoring.ts's
// starsForPercent) - these fold into the leaderboard total alongside
// quiz stars.
export function recordGameAttempt(params: {
  profileId?: string;
  classId?: string;
  subjectId?: string;
  gameKey: GameKey;
  correctCount: number;
  totalCount: number;
}): Promise<{ attemptId: string; starsEarned: number }> {
  return apiFetch(`/games/attempts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }).then((res) => asJson(res));
}

// Activity time tracking (11 September 2026) - see routes/metrics.ts.
// Fired every ~30s by useActivityHeartbeat.ts while a screen is open and
// the tab is foregrounded. profileId is never sent - the server always
// derives it from the caller's own token (see that route's own comment).
// Deliberately swallows any failure: this only powers a dashboard, never
// gameplay, so a hiccup here must never surface to the child.
export function recordActivityHeartbeat(params: {
  activityType: ActivityType;
  subjectId?: string;
  classId?: string;
  topic?: string;
  gameKey?: string;
  quizAttemptId?: string;
  tutorConversationId?: string;
}): Promise<void> {
  return apiFetch(`/metrics/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
    .then((res) => {
      if (!res.ok) throw new Error("Failed to record activity heartbeat");
    })
    .catch(() => {
      // Silently ignored by design - see useActivityHeartbeat.ts.
    });
}

// A family owner's own "Time in the Kingdom" dashboard (FamilyDashboard.tsx)
// - every child in the caller's own family, never another's (scoped
// server-side from the caller's token, same rule getFamilyProfiles
// already follows).
export function getFamilyMetricsSummary(params: { period?: MetricsPeriod } = {}): Promise<FamilyMetricsSummary> {
  return apiFetch(`/metrics/family/summary${buildQuery(params)}`).then((res) => asJson(res));
}

// The platform-admin Metrics tab (AdminDashboard.tsx) - every family, no
// scoping.
export function getAdminMetricsOverview(params: { period?: MetricsPeriod } = {}): Promise<AdminMetricsOverview> {
  return apiFetch(`/metrics/admin/overview${buildQuery(params)}`).then((res) => asJson(res));
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

// profileId is honored by the backend only for an admin-authenticated
// caller (see reportRoutes' own comment in routes/reports.ts) - a
// profile session always gets forced back to its own id regardless of
// what's passed here, so this is safe to expose to any caller. Used by
// ParentDashboard.tsx to scope one child's reports without that child
// needing to be logged in on this device.
export function getReports(params: { classId?: string; subjectName?: string; limit?: number; profileId?: string } = {}): Promise<AttemptReport[]> {
  return apiFetch(`/reports${buildQuery(params)}`).then((res) => asJson(res));
}

export function getTopicReports(params: { classId?: string; subjectName?: string; profileId?: string } = {}): Promise<TopicReport[]> {
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

// Track 7: family accounts. Creates a family + its first owner (+
// optionally a first child profile, nickname + year group per the
// Children's Code decision) in one call, and logs the owner in - same
// "store the token itself" convention as adminLogin.
export function familySignup(params: {
  familyName?: string;
  email: string;
  pin: string;
  childNickname?: string;
  childYearGroup?: string;
  childTitle?: string;
  childAvatarId?: string;
}): Promise<FamilySignupResponse> {
  return apiFetch(`/families/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
    .then((res) => asJson<FamilySignupResponse>(res))
    .then((data) => {
      setAuthToken(data.token);
      return data;
    });
}

// Bootstraps a brand-new child's PIN from the family-owner flow
// (FamilyDashboard.tsx's "add a child" step) - same endpoint as
// setProfilePin above, but deliberately does NOT store the returned
// token as the active session. There's only one stored token slot (see
// AUTH_TOKEN_STORAGE_KEY's own comment) - calling the token-storing
// setProfilePin here would silently log the family owner out of their
// own session the moment they finish adding a child. The family owner
// stays logged in; a child's own token is only ever stored when they
// explicitly log in via verifyProfilePin (the "Play" step).
export function bootstrapChildPin(profileId: string, params: { pin: string }): Promise<Profile> {
  return apiFetch(`/profiles/${profileId}/set-pin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
    .then((res) => asJson<ProfileSessionResponse>(res))
    .then((data) => data.profile);
}

export function familyLogin(params: { email: string; pin: string }): Promise<FamilyLoginResponse> {
  return apiFetch(`/families/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
    .then((res) => asJson<FamilyLoginResponse>(res))
    .then((data) => {
      setAuthToken(data.token);
      return data;
    });
}

// Every child profile belonging to the logged-in family owner's own
// family - never another family's, regardless of what's asked for (the
// server derives the filter from the caller's own token).
export function getFamilyProfiles(): Promise<Profile[]> {
  return apiFetch(`/families/me/profiles`)
    .then((res) => asJson<{ profiles: Profile[] }>(res))
    .then((r) => r.profiles);
}

// Adds a new child profile to the logged-in owner's family. Returns
// hasPin: false always (brand new) - the caller follows up with the
// existing setProfilePin(profileId, ...) to give the child a real PIN,
// same as Welcome.tsx's own newTitle -> setPin step.
export function addFamilyProfile(params: {
  nickname: string;
  yearGroup?: string;
  title?: string;
  avatarId?: string;
}): Promise<Profile & { hasPin: boolean }> {
  return apiFetch(`/families/me/profiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }).then((res) => asJson(res));
}

// The caller's own family's 4 feature toggles (migration 0027) - read
// by FamilyDashboard.tsx's "Family features" panel on mount.
// updateFamilyFeatures merges onto the existing row (only the fields
// sent are changed), same "send whichever fields changed" convention as
// updateAppSettings above.
export function getFamilyFeatures(): Promise<FamilyFeatureFlags> {
  return apiFetch(`/families/me/features`).then((res) => asJson(res));
}

export function updateFamilyFeatures(patch: Partial<FamilyFeatureFlags>): Promise<FamilyFeatureFlags> {
  return apiFetch(`/families/me/features`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((res) => asJson(res));
}

export function getAdminQuestions(
  params: { subjectName?: string; classId?: string; topic?: string; search?: string; limit?: number; cursor?: string } = {}
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

// Full, irreversible hard delete of a profile and everything tied to it
// (quiz history, Study Buddy conversations, game history) - see
// DELETE /admin/users/:profileId in admin.ts for exactly what's removed.
export async function deleteAdminUser(profileId: string): Promise<void> {
  const res = await apiFetch(`/admin/users/${profileId}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : res.statusText;
    throw new Error(message);
  }
}

// Topics (schema.ts's topics table) - class+subject scoped, ordered, with
// a difficulty tag. Admin-only CRUD; consumed elsewhere by /reports/topics
// for the quest map's node sequence.
export function getAdminTopics(params: { classId?: string; subjectId?: string } = {}): Promise<AdminTopic[]> {
  return apiFetch(`/admin/topics${buildQuery(params)}`).then((res) => asJson(res));
}

export function createAdminTopic(input: AdminTopicWriteInput): Promise<AdminTopic> {
  return apiFetch(`/admin/topics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => asJson(res));
}

export function updateAdminTopic(id: string, input: AdminTopicWriteInput): Promise<AdminTopic> {
  return apiFetch(`/admin/topics/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((res) => asJson(res));
}

export async function deleteAdminTopic(id: string): Promise<void> {
  const res = await apiFetch(`/admin/topics/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : res.statusText;
    throw new Error(message);
  }
}

// Subjects are flat and shared across classes - GET reuses the existing
// public /subjects list (no admin gate needed just to read them); only
// creating a new one is admin-only.
export function createAdminSubject(name: string): Promise<Subject> {
  return apiFetch(`/admin/subjects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }).then((res) => asJson(res));
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
// (mode: "blocked") as well as real vs. honest-fallback replies
// (mode: "ai" | "grounded" | "template") - see tutor.ts's own comments
// for what each mode means and why they're kept distinct.
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

// Wipes a profile's stored insights outright - see the backend route's
// own comment for why this exists (stale rows from an early version of
// the feature that regenerating alone can't clean up).
export function clearTutorInsights(profileId: string): Promise<void> {
  return apiFetch(`/admin/users/${profileId}/tutor-insights`, { method: "DELETE" }).then((res) => {
    if (!res.ok) throw new Error("Failed to clear insights");
  });
}

// The full admin settings singleton (Section 10 step 9, extended by
// flag-based feature management) - reads/writes the same app_settings row
// tutorBudget.ts checks on every chat turn and games.ts checks on every
// Arcade round. updateAppSettings sends whichever fields the settings
// form currently holds - PATCH merges onto the existing row either way,
// so sending everything every save is simplest and still correct.
export function getAppSettings(): Promise<AppSettings> {
  return apiFetch(`/admin/settings`).then((res) => asJson(res));
}

export function updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  return apiFetch(`/admin/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((res) => asJson(res));
}

// The public, player-facing summary of those same flags (GET /features,
// no login required) - what Home/SubjectPicker/StudyBuddy/Arcade each
// fetch for themselves on mount to decide what to show. Deliberately
// fails open (see each screen's own fallback default) rather than
// hiding a feature just because this one request hiccupped - same
// "never break the child-facing route" philosophy tutorGeneration.ts
// uses server-side.
export function getFeatures(): Promise<FeatureFlags> {
  return apiFetch(`/features`).then((res) => asJson(res));
}

// A profile's own conversation list (admin override via ?profileId=) -
// Section 10 step 9's conversation browser. Reuses the same
// TutorConversation shape general chat already uses, now carrying
// subjectName/className for display (see types.ts).
export function getTutorConversationsForProfile(profileId: string): Promise<TutorConversation[]> {
  return apiFetch(`/tutor/conversations?profileId=${profileId}`).then((res) => asJson(res));
}
