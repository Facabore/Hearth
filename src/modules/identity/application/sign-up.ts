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
    const { user } = created.value;
    let cause: string;
    try {
      const provisioned = await deps.provisionUser(user);
      if (provisioned.ok) return created;
      cause = provisioned.error.code;
    } catch {
      cause = "ProvisioningThrew";
    }
    // The provider commits the user before provisioning runs; compensate so no half-created user remains.
    try {
      await deps.auth.deleteUser(user.id);
    } catch {
      // The user exists without provisioning; the details let operators find and repair it.
      return err(domainError("InternalError", { cause, compensation: "failed", userId: user.id }));
    }
    return err(domainError("InternalError", { cause }));
  };
