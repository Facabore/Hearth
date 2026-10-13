import type { Pool } from "pg";
import {
  createArchiveAccount,
  createCreateAccount,
  createGetAccount,
  createListAccounts,
  createUpdateAccount,
  type AccountsDeps,
  type ArchiveAccount,
  type CreateAccount,
  type GetAccount,
  type ListAccounts,
  type UpdateAccount,
} from "@/modules/accounts/application";
import { DrizzleAccountRepository } from "@/modules/accounts/infrastructure/drizzle-account-repository";
import { DrizzleLedgerQueries } from "@/modules/ledger/infrastructure/drizzle-ledger-queries";
import {
  createCreateCategory,
  createCreateCategoryGroup,
  createListCategories,
  createRenameCategoryGroup,
  createSeedDefaultCategories,
  createUpdateCategory,
  type CategoriesDeps,
  type CreateCategory,
  type CreateCategoryGroup,
  type ListCategories,
  type RenameCategoryGroup,
  type UpdateCategory,
} from "@/modules/categories/application";
import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";
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
import {
  createCreatePersonalSpace,
  createGetSpace,
  createListMySpaces,
  createListSpacePeriods,
  createSpaceAccess,
  createUpdateSpaceSettings,
  type CreatePersonalSpace,
  type GetSpace,
  type ListMySpaces,
  type ListSpacePeriods,
  type StoredPeriodSource,
  type UpdateSpaceSettings,
} from "@/modules/spaces/application";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { createFixedWindowLimiter, jsonLogger, type IdempotencyDeps, type RouteDeps } from "@/shared/http";
import { createDatabase, type Database } from "@/shared/infrastructure/db/client";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { DrizzleIdempotencyStore } from "@/shared/infrastructure/drizzle-idempotency-store";
import { loadEnv, type Env } from "@/shared/infrastructure/env";
import { SystemClock } from "@/shared/infrastructure/system-clock";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { map, type AuthUser, type Result } from "@/shared/kernel";

/** Process-wide dependencies, built once from the environment. */
export interface Container extends RouteDeps {
  readonly db: Database;
  readonly pool: Pool;
  readonly tm: DrizzleTransactionManager;
  readonly idempotency: IdempotencyDeps;
  readonly identity: { readonly signUp: SignUp; readonly signIn: SignIn; readonly signOut: SignOut };
  readonly spaces: {
    readonly createPersonalSpace: CreatePersonalSpace;
    readonly listMySpaces: ListMySpaces;
    readonly getSpace: GetSpace;
    readonly updateSettings: UpdateSpaceSettings;
    readonly listPeriods: ListSpacePeriods;
  };
  readonly categories: {
    readonly listCategories: ListCategories;
    readonly createCategoryGroup: CreateCategoryGroup;
    readonly renameCategoryGroup: RenameCategoryGroup;
    readonly createCategory: CreateCategory;
    readonly updateCategory: UpdateCategory;
  };
  readonly accounts: {
    readonly createAccount: CreateAccount;
    readonly updateAccount: UpdateAccount;
    readonly archiveAccount: ArchiveAccount;
    readonly listAccounts: ListAccounts;
    readonly getAccount: GetAccount;
  };
  /** Brute-force guards for the unauthenticated identity routes; false means "reject with 429". */
  readonly authThrottle: {
    readonly signIn: (ip: string, email: string) => boolean;
    readonly signUp: (ip: string) => boolean;
  };
}

export interface AuthLimits {
  /** Sign-in attempts per email per 15 minutes. */
  readonly signInPerEmail: number;
  /** Sign-in attempts per client address per 15 minutes. */
  readonly signInPerIp: number;
  /** Sign-ups per client address per hour. */
  readonly signUpPerIp: number;
}

const DEFAULT_AUTH_LIMITS: AuthLimits = { signInPerEmail: 10, signInPerIp: 30, signUpPerIp: 10 };
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

export interface ContainerOptions {
  /** Test seam: replaces the post-sign-up provisioning step. */
  readonly provisionUser?: (user: AuthUser) => Promise<Result<void>>;
  readonly authLimits?: AuthLimits;
}

export const buildContainer = (env: Env, options: ContainerOptions = {}): Container => {
  const { db, pool } = createDatabase(env.DATABASE_URL);
  const tm = new DrizzleTransactionManager(db);
  const ids = new UuidV7IdGenerator();
  const clock = new SystemClock();
  const provider = new BetterAuthProvider(
    createAuth({ db, secret: env.BETTER_AUTH_SECRET, baseURL: env.BETTER_AUTH_URL }),
    db,
  );
  const spaceRepository = new DrizzleSpaceRepository(tm);
  const access = createSpaceAccess(spaceRepository);
  const categoriesDeps: CategoriesDeps = {
    categories: new DrizzleCategoryRepository(tm),
    access,
    ids,
    clock,
    tm,
  };
  const seedDefaultCategories = createSeedDefaultCategories(categoriesDeps);
  const ledgerQueries = new DrizzleLedgerQueries(tm);
  // HU-E2-04: balance = opening balance + ledger movements, computed on read (D7).
  const accountsDeps: AccountsDeps = {
    accounts: new DrizzleAccountRepository(tm),
    access,
    movements: ledgerQueries,
    ids,
    clock,
    tm,
  };
  // Budget plans (stored period boundaries, D10) arrive with HU-E6-01; until then periods come from the policy.
  const storedPeriods: StoredPeriodSource = async () => [];
  const createPersonalSpace = createCreatePersonalSpace({
    spaces: spaceRepository,
    ids,
    clock,
    tm,
    // HU-E3-01: default categories are seeded in the same transaction as the space.
    onCreated: (space, { locale }) => seedDefaultCategories({ spaceId: space.id, locale }),
  });
  // HU-E1-02: every new user gets a personal space; sign-up compensates if this fails.
  const provisionUser =
    options.provisionUser ??
    (async (u: AuthUser) =>
      map(await createPersonalSpace({ userId: u.id, name: u.name, locale: u.locale }), () => undefined));
  const limits = options.authLimits ?? DEFAULT_AUTH_LIMITS;
  const signInByEmail = createFixedWindowLimiter({ limit: limits.signInPerEmail, windowMs: FIFTEEN_MINUTES });
  const signInByIp = createFixedWindowLimiter({ limit: limits.signInPerIp, windowMs: FIFTEEN_MINUTES });
  const signUpByIp = createFixedWindowLimiter({ limit: limits.signUpPerIp, windowMs: ONE_HOUR });
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
    spaces: {
      createPersonalSpace,
      listMySpaces: createListMySpaces(spaceRepository),
      getSpace: createGetSpace(access),
      updateSettings: createUpdateSpaceSettings({
        spaces: spaceRepository,
        access,
        tm,
        usage: {
          hasMoneyRecords: async (spaceId) =>
            (await accountsDeps.accounts.listBySpace(spaceId)).length > 0 ||
            (await ledgerQueries.hasTransactions(spaceId)),
        },
      }),
      listPeriods: createListSpacePeriods({ access, storedPeriods, clock, timeZone: env.APP_TIMEZONE }),
    },
    categories: {
      listCategories: createListCategories(categoriesDeps),
      createCategoryGroup: createCreateCategoryGroup(categoriesDeps),
      renameCategoryGroup: createRenameCategoryGroup(categoriesDeps),
      createCategory: createCreateCategory(categoriesDeps),
      updateCategory: createUpdateCategory(categoriesDeps),
    },
    accounts: {
      createAccount: createCreateAccount(accountsDeps),
      updateAccount: createUpdateAccount(accountsDeps),
      archiveAccount: createArchiveAccount(accountsDeps),
      listAccounts: createListAccounts(accountsDeps),
      getAccount: createGetAccount(accountsDeps),
    },
    authThrottle: {
      // Both counters advance on every attempt, so neither can be probed independently.
      signIn: (ip, email) => [signInByIp.hit(ip), signInByEmail.hit(email)].every(Boolean),
      signUp: (ip) => signUpByIp.hit(ip),
    },
  };
};

let container: Container | undefined;

export const getContainer = (): Container => (container ??= buildContainer(loadEnv()));

export const setContainerForTests = (next: Container | undefined): void => {
  container = next;
};
