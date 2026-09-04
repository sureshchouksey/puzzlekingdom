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
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    SUPABASE_URL: z.string().min(1, "SUPABASE_URL is required"),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
    SUPABASE_STORAGE_BUCKET: z.string().default("course-content"),
    // Shared family passcode gating every route except /health, for the
    // public deployment. Optional on purpose: leaving it unset (local dev,
    // LAN-only access) disables the gate entirely, so nothing changes for
    // development.
    APP_PASSCODE: z.string().optional(),
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
