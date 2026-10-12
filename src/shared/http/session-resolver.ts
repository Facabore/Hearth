import type { AuthUser } from "@/shared/kernel";

/** Resolves the acting user from a session cookie or an `Authorization: Bearer` header. */
export interface SessionResolver {
  resolve(headers: Headers): Promise<AuthUser | null>;
}
