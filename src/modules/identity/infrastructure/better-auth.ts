import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import type { Database } from "@/shared/infrastructure/db/client";
import { account, session, user, verification } from "./auth.schema";

/**
 * Ruling P150: a session lasts 15 days from its last use. Better Auth renews it once a day while it is used
 * (`updateAge`), so a regular visitor stays signed in and an idle one signs in again after 15 days.
 */
export const SESSION_TTL_SECONDS = 15 * 24 * 60 * 60;
const SESSION_RENEWAL_SECONDS = 24 * 60 * 60;

export const createAuth = (opts: {
  db: Database;
  secret: string;
  baseURL: string;
  defaultTimeZone: string;
}) =>
  betterAuth({
    secret: opts.secret,
    baseURL: opts.baseURL,
    basePath: "/api/auth",
    database: drizzleAdapter(opts.db, { provider: "pg", schema: { user, session, account, verification } }),
    session: { expiresIn: SESSION_TTL_SECONDS, updateAge: SESSION_RENEWAL_SECONDS },
    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128, autoSignIn: true },
    user: {
      additionalFields: {
        locale: { type: "string", required: false, defaultValue: "es", input: false },
        // HU-E1-14: sign-up writes the browser's zone through UserProfiles; APP_TIMEZONE until then.
        timezone: { type: "string", required: false, defaultValue: opts.defaultTimeZone, input: false },
      },
    },
    advanced: { cookiePrefix: "hearth" },
    // Self-hosted household finance data: never phone home, whatever the environment says.
    telemetry: { enabled: false },
    plugins: [bearer()],
  });

export type Auth = ReturnType<typeof createAuth>;
