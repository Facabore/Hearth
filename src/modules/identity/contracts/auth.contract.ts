import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { problemContent } from "@/shared/http/contracts";
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
});
export const SignInBodySchema = z.object({ email: Email, password: z.string().max(128) });
export const SignUpResponseSchema = z.object({ user: MeResponseSchema });
export const SignInResponseSchema = z.object({ user: MeResponseSchema, token: z.string().nullable() });

const json = (schema: z.ZodType) => ({ "application/json": { schema } });

export const authPaths: ZodOpenApiPathsObject = {
  "/api/v1/auth/sign-up": {
    post: {
      operationId: "signUp",
      summary: "Create an account and start a session",
      requestBody: { content: json(SignUpBodySchema) },
      responses: {
        "201": {
          description: "Account created; sets the session cookie",
          content: json(SignUpResponseSchema),
        },
        "409": { description: "EmailTaken", content: problemContent },
        "422": { description: "ValidationFailed, PasswordTooShort, InvalidEmail", content: problemContent },
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
