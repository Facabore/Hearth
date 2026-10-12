import type { Pool } from "pg";
import {
  createSignIn,
  createSignOut,
  createSignUp,
  type SignIn,
  type SignOut,
  type SignUp,
} from "@/modules/identity/application";
import { createAuth } from "@/modules/identity/infrastructure/better-auth";
import { BetterAuthProvider } from "@/modules/identity/infrastructure/better-auth-provider";
import { jsonLogger, type IdempotencyDeps, type RouteDeps } from "@/shared/http";
import { createDatabase, type Database } from "@/shared/infrastructure/db/client";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { DrizzleIdempotencyStore } from "@/shared/infrastructure/drizzle-idempotency-store";
import { loadEnv, type Env } from "@/shared/infrastructure/env";
import { ok, type AuthUser, type Result } from "@/shared/kernel";

/** Process-wide dependencies, built once from the environment. */
export interface Container extends RouteDeps {
  readonly db: Database;
  readonly pool: Pool;
  readonly tm: DrizzleTransactionManager;
  readonly idempotency: IdempotencyDeps;
  readonly identity: { readonly signUp: SignUp; readonly signIn: SignIn; readonly signOut: SignOut };
}

export interface ContainerOptions {
  /** Test seam: replaces the post-sign-up provisioning step. */
  readonly provisionUser?: (user: AuthUser) => Promise<Result<void>>;
}

export const buildContainer = (env: Env, options: ContainerOptions = {}): Container => {
  const { db, pool } = createDatabase(env.DATABASE_URL);
  const tm = new DrizzleTransactionManager(db);
  const provider = new BetterAuthProvider(
    createAuth({ db, secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL }),
    db,
  );
  // Task 11 provisions the personal space here.
  const provisionUser = options.provisionUser ?? (async () => ok(undefined));
  return {
    db,
    pool,
    tm,
    logger: jsonLogger,
    sessionResolver: provider,
    idempotency: { tm, store: new DrizzleIdempotencyStore(tm) },
    identity: {
      signUp: createSignUp({ auth: provider, provisionUser }),
      signIn: createSignIn(provider),
      signOut: createSignOut(provider),
    },
  };
};

let container: Container | undefined;

export const getContainer = (): Container => (container ??= buildContainer(loadEnv()));

export const setContainerForTests = (next: Container | undefined): void => {
  container = next;
};
