import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";
import type { Database } from "@/shared/infrastructure/db/client";
import type { Mailer } from "@/shared/infrastructure/email/smtp-mailer";
import { account, session, user, verification } from "./auth.schema";
import { verificationMessage, verificationUrl } from "./verification-email";

/**
 * Ruling P150: a session lasts 15 days from its last use. Better Auth renews it once a day while it is used
 * (`updateAge`), so a regular visitor stays signed in and an idle one signs in again after 15 days.
 */
export const SESSION_TTL_SECONDS = 15 * 24 * 60 * 60;
const SESSION_RENEWAL_SECONDS = 24 * 60 * 60;
/** Issue #86: a verification link lasts as long as an invitation (7 days), so a person invited by email can still use it. */
export const VERIFICATION_TTL_SECONDS = 7 * 24 * 60 * 60;

export const createAuth = (opts: {
  db: Database;
  secret: string;
  baseURL: string;
  defaultTimeZone: string;
  /**
   * Issue #86, ruling P282: with SMTP configured, a new account is sent a link that confirms its address, and an email
   * invitation then admits only a confirmed one. Without it nobody could confirm, so nothing is sent or asked.
   */
  mailer?: Mailer | null;
}) =>
  betterAuth({
    secret: opts.secret,
    baseURL: opts.baseURL,
    basePath: "/api/auth",
    database: drizzleAdapter(opts.db, { provider: "pg", schema: { user, session, account, verification } }),
    session: { expiresIn: SESSION_TTL_SECONDS, updateAge: SESSION_RENEWAL_SECONDS },
    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128, autoSignIn: true },
    ...(opts.mailer ? { emailVerification: emailVerification(opts.mailer, opts.baseURL) } : {}),
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

/**
 * Signing in never waits for a confirmed address (`requireEmailVerification` stays off): only email invitations ask for
 * one. The link opens the SPA, never Better Auth's own /api/auth route, which Hearth does not serve. A send that fails
 * is logged by the mailer and never fails the sign-up.
 */
const emailVerification = (mailer: Mailer, baseURL: string) => ({
  sendOnSignUp: true,
  expiresIn: VERIFICATION_TTL_SECONDS,
  sendVerificationEmail: async ({ user: to, token }: { user: { email: string }; token: string }) => {
    await mailer.send({ to: to.email, ...verificationMessage(verificationUrl(baseURL, token)) });
  },
});

export type Auth = ReturnType<typeof createAuth>;
