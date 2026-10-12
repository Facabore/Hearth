import type { AuthUser, Result } from "@/shared/kernel";

export interface AuthSession {
  readonly user: AuthUser;
  /** Bearer token for non-browser clients. */
  readonly token: string | null;
  /** Set-Cookie header values for browsers. */
  readonly cookies: readonly string[];
}

/** Port to the identity provider (Better Auth in production). */
export interface AuthProvider {
  signUp(input: { name: string; email: string; password: string }): Promise<Result<AuthSession>>;
  signIn(input: { email: string; password: string }): Promise<Result<AuthSession>>;
  signOut(credentials: {
    cookie?: string;
    authorization?: string;
  }): Promise<Result<{ cookies: readonly string[] }>>;
  /** Compensation when post-sign-up provisioning fails (sessions and accounts cascade). */
  deleteUser(userId: string): Promise<void>;
}
