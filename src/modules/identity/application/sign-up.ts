import { domainError, err, type AuthUser, type Result } from "@/shared/kernel";
import type { AuthProvider, AuthSession } from "./auth-provider";

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export interface SignUpDeps {
  readonly auth: AuthProvider;
  /** Creates everything a new user needs (the personal space, Task 11). */
  readonly provisionUser: (user: AuthUser) => Promise<Result<void>>;
}

export type SignUp = (input: {
  name: string;
  email: string;
  password: string;
}) => Promise<Result<AuthSession>>;

export const createSignUp =
  (deps: SignUpDeps): SignUp =>
  async (input) => {
    const created = await deps.auth.signUp({ ...input, email: normalizeEmail(input.email) });
    if (!created.ok) return created;
    let provisioned: Result<void>;
    try {
      provisioned = await deps.provisionUser(created.value.user);
    } catch {
      provisioned = err(domainError("InternalError"));
    }
    if (provisioned.ok) return created;
    // The provider commits the user before provisioning runs; compensate so no half-created user remains.
    await deps.auth.deleteUser(created.value.user.id);
    return err(domainError("InternalError", { cause: provisioned.error.code }));
  };
