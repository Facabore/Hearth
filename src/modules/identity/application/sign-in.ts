import type { Result } from "@/shared/kernel";
import type { AuthProvider, AuthSession } from "./auth-provider";
import { normalizeEmail } from "./sign-up";

export type SignIn = (input: { email: string; password: string }) => Promise<Result<AuthSession>>;

export const createSignIn =
  (auth: AuthProvider): SignIn =>
  (input) =>
    auth.signIn({ email: normalizeEmail(input.email), password: input.password });
