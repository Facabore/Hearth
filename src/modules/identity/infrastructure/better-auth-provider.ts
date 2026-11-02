import { eq } from "drizzle-orm";
import type { SessionResolver } from "@/shared/http";
import type { Database } from "@/shared/infrastructure/db/client";
import {
  canonicalTimeZone,
  domainError,
  err,
  ok,
  type AuthUser,
  type DomainError,
  type Result,
} from "@/shared/kernel";
import type { AuthProvider, AuthSession } from "../application/auth-provider";
import type { EmailVerifier } from "../application/verify-email";
import { normalizeEmail } from "../application/sign-up";
import { user } from "./auth.schema";
import type { Auth } from "./better-auth";

// Better Auth error codes (checked against better-auth 1.7.7) mapped to Hearth's stable codes.
const ERROR_CODES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^USER_ALREADY_EXISTS/, "EmailTaken"],
  [/^PASSWORD_TOO_SHORT$/, "PasswordTooShort"],
  [/^PASSWORD_TOO_LONG$/, "InvalidPassword"],
  [/^INVALID_EMAIL_OR_PASSWORD$/, "InvalidCredentials"],
  [/^INVALID_EMAIL$/, "InvalidEmail"],
];

const toAuthUser = (u: Record<string, unknown>, defaultTimeZone: string): AuthUser => ({
  id: String(u.id),
  name: String(u.name),
  email: String(u.email),
  locale: String(u.locale ?? "es"),
  // Ruling P45: the same normalisation as UserTimeZones, so no route receives a zone Intl would throw on.
  timezone: canonicalTimeZone(String(u.timezone ?? "")) ?? defaultTimeZone,
});

const toDomainError = async (response: Response): Promise<DomainError> => {
  const body = (await response.json().catch(() => ({}))) as { code?: string };
  const match = ERROR_CODES.find(([pattern]) => pattern.test(body.code ?? ""));
  return domainError(match?.[1] ?? "InternalError", { provider: body.code ?? response.status });
};

/** Adapts Better Auth to the identity port and resolves sessions (cookie or Bearer) for routes. */
export class BetterAuthProvider implements AuthProvider, EmailVerifier, SessionResolver {
  constructor(
    private readonly auth: Auth,
    private readonly db: Database,
    /** APP_TIMEZONE (HU-E1-14). */
    private readonly defaultTimeZone: string,
  ) {}

  async signUp(input: { name: string; email: string; password: string }): Promise<Result<AuthSession>> {
    return this.toSession(await this.auth.api.signUpEmail({ body: input, asResponse: true }));
  }

  async signIn(input: { email: string; password: string }): Promise<Result<AuthSession>> {
    return this.toSession(await this.auth.api.signInEmail({ body: input, asResponse: true }));
  }

  async signOut(credentials: {
    cookie?: string;
    authorization?: string;
  }): Promise<Result<{ cookies: readonly string[] }>> {
    const headers = new Headers();
    if (credentials.cookie) headers.set("cookie", credentials.cookie);
    if (credentials.authorization) headers.set("authorization", credentials.authorization);
    const response = await this.auth.api.signOut({ headers, asResponse: true });
    return response.ok
      ? ok({ cookies: response.headers.getSetCookie() })
      : err(await toDomainError(response));
  }

  async deleteUser(userId: string): Promise<void> {
    await this.db.delete(user).where(eq(user.id, userId));
  }

  /** The user registered with `email` (stored lower-cased, HU-E1-01); the spaces module refuses to invite members with it (HU-E1-06). */
  async findUserIdByEmail(email: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, normalizeEmail(email)))
      .limit(1);
    return row?.id ?? null;
  }

  /** Issue #86: whether the account confirmed its address through the link it was sent. */
  async isEmailVerified(userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ verified: user.emailVerified })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return row?.verified === true;
  }

  /**
   * Issue #86: sends the account registered with `email` a fresh verification link, unless its address is confirmed
   * already. Better Auth answers alike whether or not such an account exists; a failed send is the mailer's to log.
   */
  async requestVerification(email: string): Promise<void> {
    await this.auth.api.sendVerificationEmail({ body: { email }, asResponse: true });
  }

  /**
   * Issue #86: confirms the address the link's token names. A token that is malformed, expired, forged or names no
   * account is InvalidVerificationLink; a confirmed address confirmed again is ok.
   */
  async verifyEmail(token: string): Promise<Result<void>> {
    const response = await this.auth.api.verifyEmail({ query: { token }, asResponse: true });
    return response.ok ? ok(undefined) : err(domainError("InvalidVerificationLink"));
  }

  async resolve(headers: Headers): Promise<AuthUser | null> {
    const result = await this.auth.api.getSession({ headers });
    return result ? toAuthUser(result.user as Record<string, unknown>, this.defaultTimeZone) : null;
  }

  private async toSession(response: Response): Promise<Result<AuthSession>> {
    if (!response.ok) return err(await toDomainError(response));
    const body = (await response.json()) as { user: Record<string, unknown>; token?: string | null };
    return ok({
      user: toAuthUser(body.user, this.defaultTimeZone),
      token: response.headers.get("set-auth-token") ?? body.token ?? null,
      cookies: response.headers.getSetCookie(),
    });
  }
}
