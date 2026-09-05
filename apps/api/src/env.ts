import { z } from "zod";

const envSchema = z
  .object({
    PORT: z.coerce.number().default(3001),
    // Which AI provider generates quiz questions from uploaded content.
    // Only the matching provider's API key is required - see the
    // superRefine below.
    AI_PROVIDER: z.enum(["claude", "gemini"]).default("claude"),
    ANTHROPIC_API_KEY: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
    // Deliberately a SEPARATE model from GEMINI_MODEL above. GEMINI_MODEL
    // generates quiz questions and is free to be whatever the best paid
    // model is; the tutor (plan/AI-Study-Mentor-Agent-Plan.md, Section 6)
    // has to stay on a genuinely free-tier model no matter what
    // GEMINI_MODEL is set to, since Section 9's whole shared-daily-budget
    // design assumes $0 marginal cost per tutor reply. gemini-3.1-flash-lite
    // is the current free-tier model (confirmed via Google's own model
    // page, September 2026) - if Google ever moves it behind billing (see
    // Section 6's own note that this has already happened to Pro models),
    // this is the one line to change, and the tutor's real-cost assumption
    // in Section 6 needs revisiting at the same time.
    GEMINI_TUTOR_MODEL: z.string().default("gemini-3.1-flash-lite"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    SUPABASE_URL: z.string().min(1, "SUPABASE_URL is required"),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
    SUPABASE_STORAGE_BUCKET: z.string().default("course-content"),
    // Shared family passcode gating every route except /health, for the
    // public deployment. Optional on purpose: leaving it unset (local dev,
    // LAN-only access) disables the gate entirely, so nothing changes for
    // development.
    APP_PASSCODE: z.string().optional(),
    // Signs profile/admin session JWTs. Required (unlike APP_PASSCODE) -
    // real per-user sessions need a real secret even in local dev, since
    // reports privacy depends on it.
    JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  })
  .superRefine((data, ctx) => {
    if (data.AI_PROVIDER === "claude" && !data.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ANTHROPIC_API_KEY"],
        message: "ANTHROPIC_API_KEY is required when AI_PROVIDER=claude",
      });
    }
    if (data.AI_PROVIDER === "gemini" && !data.GEMINI_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GEMINI_API_KEY"],
        message: "GEMINI_API_KEY is required when AI_PROVIDER=gemini",
      });
    }
  });

export const env = envSchema.parse(process.env);
