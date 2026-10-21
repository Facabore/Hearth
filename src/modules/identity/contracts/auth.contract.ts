import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { problemContent } from "@/shared/http/contracts";
import { LOCALES } from "../domain/preferences";
import { MeResponseSchema } from "./me.contract";

const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { error: "Invalid email" });

/** Password length rules are enforced by the auth provider so clients get PasswordTooShort, not ValidationFailed. */
export const SignUpBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: Email,
  password: z.string().max(128),
  /** HU-E1-14: the browser's IANA zone; a missing, malformed or unknown one becomes APP_TIMEZONE, never a refusal. */
  timezone: z.string().max(64).optional().catch(undefined),
  /** Ruling P142: the language the visitor used on the sign-up screen; any other value is ignored, never a refusal. */
  locale: z.enum(LOCALES).optional().catch(undefined),
  /**
   * Ruling P143: the invitation or claim link token that lets a visitor sign up while HEARTH_SIGN_UP is `closed`; an
   * open installation ignores it, and an unusable value is the same SignUpClosed as none.
   */
  invitationToken: z.string().max(512).optional().catch(undefined),
});
export const SignInBodySchema = z.object({ email: Email, password: z.string().max(128) });
export const SignUpResponseSchema = z.object({ user: MeResponseSchema });
/** Ruling P143: lets the sign-up screen explain a closed installation and the sign-in screen hide "Create account". */
export const SignUpModeResponseSchema = z.object({ signUp: z.enum(["open", "closed"]) });
export const SignInResponseSchema = z.object({ user: MeResponseSchema, token: z.string().nullable() });

const json = (schema: z.ZodType) => ({ "application/json": { schema } });

export const authPaths: ZodOpenApiPathsObject = {
  "/api/v1/auth/sign-up": {
    get: {
      operationId: "getSignUpMode",
      summary: "Tell whether sign-up is open or closed to invited visitors",
      responses: {
        "200": { description: "The installation's sign-up mode", content: json(SignUpModeResponseSchema) },
      },
    },
    post: {
      operationId: "signUp",
      summary: "Create an account and start a session",
      requestBody: { content: json(SignUpBodySchema) },
      responses: {
        "201": {
          description: "Account created; sets the session cookie",
          content: json(SignUpResponseSchema),
        },
        "403": { description: "SignUpClosed", content: problemContent },
        "409": { description: "EmailTaken", content: problemContent },
        "422": {
          description: "ValidationFailed, PasswordTooShort, InvalidPassword, InvalidEmail",
          content: problemContent,
        },
        "429": { description: "TooManyRequests", content: problemContent },
      },
    },
  },
  "/api/v1/auth/sign-in": {
    post: {
      operationId: "signIn",
      summary: "Start a session (cookie) and get a Bearer token",
      requestBody: { content: json(SignInBodySchema) },
      responses: {
        "200": { description: "Signed in", content: json(SignInResponseSchema) },
        "401": { description: "InvalidCredentials", content: problemContent },
        "429": { description: "TooManyRequests", content: problemContent },
      },
    },
  },
  "/api/v1/auth/sign-out": {
    post: {
      operationId: "signOut",
      summary: "Revoke the current session",
      security: [{ cookieAuth: [] }, { bearerAuth: [] }],
      responses: {
        "204": { description: "Signed out" },
        "401": { description: "Unauthenticated", content: problemContent },
      },
    },
  },
};
