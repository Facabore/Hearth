import type { Result } from "@/shared/kernel";
import type { AuthProvider } from "./auth-provider";

export type SignOut = (credentials: {
  cookie?: string;
  authorization?: string;
}) => Promise<Result<{ cookies: readonly string[] }>>;

export const createSignOut =
  (auth: AuthProvider): SignOut =>
  (credentials) =>
    auth.signOut(credentials);
