import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import type { Database } from "@/shared/infrastructure/db/client";
import { account, session, user, verification } from "./auth.schema";

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
