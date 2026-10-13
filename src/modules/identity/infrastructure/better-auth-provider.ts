import { eq } from "drizzle-orm";
import type { SessionResolver } from "@/shared/http";
import type { Database } from "@/shared/infrastructure/db/client";
import { domainError, err, ok, type AuthUser, type DomainError, type Result } from "@/shared/kernel";
import type { AuthProvider, AuthSession } from "../application/auth-provider";
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

const toAuthUser = (u: Record<string, unknown>): AuthUser => ({
  id: String(u.id),
  name: String(u.name),
  email: String(u.email),
  locale: String(u.locale ?? "es"),
  timezone: String(u.timezone ?? "America/Bogota"),
});

const toDomainError = async (response: Response): Promise<DomainError> => {
  const body = (await response.json().catch(() => ({}))) as { code?: string };
  const match = ERROR_CODES.find(([pattern]) => pattern.test(body.code ?? ""));
  return domainError(match?.[1] ?? "InternalError", { provider: body.code ?? response.status });
};

/** Adapts Better Auth to the identity port and resolves sessions (cookie or Bearer) for routes. */
export class BetterAuthProvider implements AuthProvider, SessionResolver {
  constructor(
    private readonly auth: Auth,
    private readonly db: Database,
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

  async resolve(headers: Headers): Promise<AuthUser | null> {
    const result = await this.auth.api.getSession({ headers });
    return result ? toAuthUser(result.user as Record<string, unknown>) : null;
  }

  private async toSession(response: Response): Promise<Result<AuthSession>> {
    if (!response.ok) return err(await toDomainError(response));
    const body = (await response.json()) as { user: Record<string, unknown>; token?: string | null };
    return ok({
      user: toAuthUser(body.user),
      token: response.headers.get("set-auth-token") ?? body.token ?? null,
      cookies: response.headers.getSetCookie(),
    });
  }
}
