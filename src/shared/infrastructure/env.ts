import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  APP_TIMEZONE: z.string().min(1).default("America/Bogota"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /**
   * HU-E4-12: seconds between runs of the recurring-transactions job; 0 turns it off. Digits only: a blank value must
   * not read as 0 (`Number("")`), which would turn the job off. One day at most, far below the largest timer delay.
   */
  RECURRENCE_JOB_INTERVAL_SECONDS: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().max(86_400))
    .default(300),
  /** Ruling P143: `closed` makes sign-up invite-only (an invitation or claim link token still lets a visitor in). */
  HEARTH_SIGN_UP: z.enum(["open", "closed"]).default("open"),
  /**
   * Ruling P133, e2e only: fixes the API's clock (and, through serverNow, the server renders') at this instant, so a
   * scenario's "Given the Clock reads …" holds on both sides. Never set in production: `docker compose` does not pass it.
   */
  HEARTH_E2E_FIXED_NOW: z.iso.datetime({ offset: true }).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export class EnvError extends Error {
  override readonly name = "EnvError";
}

/** Validates the environment once at startup; the error names variables, never their values. */
export const loadEnv = (source: Record<string, string | undefined> = process.env): Env => {
  const parsed = EnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;
  const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))].sort();
  throw new EnvError(`Missing or invalid environment variables: ${names.join(", ")}`);
};
