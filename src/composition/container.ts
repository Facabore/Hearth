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
import {
  createDeleteTransaction,
  createEditTransaction,
  createGetTransaction,
  createListAudit,
  createListTransactions,
  createRecordExpense,
  createRecordIncome,
  createRecordTransfer,
  type DeleteTransaction,
  type EditTransaction,
  type GetTransaction,
  type LedgerDeps,
  type ListAudit,
  type ListTransactions,
  type RecordExpense,
  type RecordIncome,
  type RecordTransfer,
} from "@/modules/ledger/application";
import { DrizzleAuditLog } from "@/modules/ledger/infrastructure/drizzle-audit-log";
import { DrizzleLedgerQueries } from "@/modules/ledger/infrastructure/drizzle-ledger-queries";
import { DrizzleTransactionRepository } from "@/modules/ledger/infrastructure/drizzle-transaction-repository";
import {
  createArchiveCategory,
  createArchiveCategoryGroup,
  createCreateCategory,
  createCreateCategoryGroup,
  createDeleteCategory,
  createListCategories,
  createRenameCategoryGroup,
  createRestoreCategory,
  createSeedDefaultCategories,
  createUpdateCategory,
  type ArchiveCategory,
  type ArchiveCategoryGroup,
  type CategoriesDeps,
  type CreateCategory,
  type CreateCategoryGroup,
  type DeleteCategory,
  type ListCategories,
  type RenameCategoryGroup,
  type RestoreCategory,
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
  createAcceptInvitation,
  createAddGuestMember,
  createChangeMemberRole,
  createCreateInvitation,
  createCreatePersonalSpace,
  createCreateSpace,
  createGetSpace,
  createListMembers,
  createListMySpaces,
  createListSpacePeriods,
  createRevokeInvitation,
  createSpaceAccess,
  createUpdateSpaceSettings,
  type AcceptInvitation,
  type AddGuestMember,
  type ChangeMemberRole,
  type CreateInvitation,
  type CreatePersonalSpace,
  type CreateSpace,
  type EmailSender,
  type GetSpace,
  type InvitationsDeps,
  type ListMembers,
  type ListMySpaces,
  type ListSpacePeriods,
  type MembersDeps,
  type RevokeInvitation,
  type SpaceCreatedListener,
  type StoredPeriodSource,
  type UpdateSpaceSettings,
} from "@/modules/spaces/application";
import { cryptoInvitationTokens } from "@/modules/spaces/infrastructure/crypto-invitation-tokens";
import { DrizzleInvitationRepository } from "@/modules/spaces/infrastructure/drizzle-invitation-repository";
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
    readonly createSpace: CreateSpace;
    readonly listMembers: ListMembers;
    readonly createInvitation: CreateInvitation;
    readonly revokeInvitation: RevokeInvitation;
    readonly acceptInvitation: AcceptInvitation;
    readonly addGuest: AddGuestMember;
    readonly changeMemberRole: ChangeMemberRole;
  };
  readonly categories: {
    readonly listCategories: ListCategories;
    readonly createCategoryGroup: CreateCategoryGroup;
    readonly renameCategoryGroup: RenameCategoryGroup;
    readonly createCategory: CreateCategory;
    readonly updateCategory: UpdateCategory;
    readonly deleteCategory: DeleteCategory;
    readonly archiveCategory: ArchiveCategory;
    readonly restoreCategory: RestoreCategory;
    readonly archiveCategoryGroup: ArchiveCategoryGroup;
  };
  readonly accounts: {
    readonly createAccount: CreateAccount;
    readonly updateAccount: UpdateAccount;
    readonly archiveAccount: ArchiveAccount;
    readonly listAccounts: ListAccounts;
    readonly getAccount: GetAccount;
  };
  readonly ledger: {
    readonly recordExpense: RecordExpense;
    readonly recordIncome: RecordIncome;
    readonly recordTransfer: RecordTransfer;
    readonly listTransactions: ListTransactions;
    readonly getTransaction: GetTransaction;
    readonly editTransaction: EditTransaction;
    readonly deleteTransaction: DeleteTransaction;
    readonly listAudit: ListAudit;
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
  /** Delivers invitation emails; v1 has no SMTP adapter, so delivery is disabled unless a test passes one. */
  readonly emailSender?: EmailSender;
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
  const getAccount = createGetAccount(accountsDeps);
  const ledgerDeps: LedgerDeps = {
    access,
    transactions: new DrizzleTransactionRepository(tm),
    // HU-E4-07: payers and participants are current members of the space, in join order.
    members: spaceRepository,
    query: ledgerQueries,
    audit: new DrizzleAuditLog(tm),
    // Adapters keep the ledger independent of the accounts and categories modules.
    accounts: {
      find: async (accountId) => {
        const account = await accountsDeps.accounts.findById(accountId);
        return account
          ? {
              id: account.id,
              spaceId: account.spaceId,
              ownerUserId: account.ownerUserId,
              isSharedFund: account.type === "SHARED_FUND",
              archived: account.archivedAt !== null,
            }
          : null;
      },
    },
    categories: {
      find: async (spaceId, categoryId) => {
        const category = (await categoriesDeps.categories.listCategories(spaceId)).find(
          (c) => c.id === categoryId,
        );
        return category ? { id: category.id, archived: category.archivedAt !== null } : null;
      },
    },
    // Closing plans arrives with HU-E6-07; until then no period is closed.
    closedPeriods: { isClosed: async () => false },
    storedPeriods,
    // HU-E4-10: the accounts module owns the balance formula (opening balance + movements, HU-E2-04).
    accountBalances: {
      balanceOf: async (spaceId, userId, accountId) => {
        const account = await getAccount({ spaceId, userId, accountId });
        // The fund was found in this space within the same transaction, so this read succeeds.
        return account.ok ? account.value.balance : 0n;
      },
    },
    ids,
    clock,
    timeZone: env.APP_TIMEZONE,
    tm,
  };
  // HU-E3-01: default categories in the creator's locale, seeded in the same transaction as the space.
  const onSpaceCreated: SpaceCreatedListener = (space, { locale }) =>
    seedDefaultCategories({ spaceId: space.id, locale });
  const createPersonalSpace = createCreatePersonalSpace({
    spaces: spaceRepository,
    ids,
    clock,
    tm,
    onCreated: onSpaceCreated,
  });
  const membersDeps: MembersDeps = { access, members: spaceRepository, ids, clock, tm };
  const invitationsDeps: InvitationsDeps = {
    access,
    members: spaceRepository,
    invitations: new DrizzleInvitationRepository(tm),
    tokens: cryptoInvitationTokens,
    // No SMTP adapter in v1 (no new dependencies): the response carries the URL and emailSent is false.
    emailSender: options.emailSender ?? { send: async () => false },
    // HU-E1-06: refusing to invite current members needs the identity module's users.
    users: { idByEmail: (email) => provider.findUserIdByEmail(email) },
    // The web page that accepts an invitation (HU-E9-05); the URL carries only the token.
    invitationUrl: (token) => new URL(`/invitations/${token}`, env.BETTER_AUTH_URL).toString(),
    ids,
    clock,
    tm,
  };
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
      createSpace: createCreateSpace({
        spaces: spaceRepository,
        createPersonalSpace,
        onCreated: onSpaceCreated,
        ids,
        clock,
        tm,
      }),
      listMembers: createListMembers(membersDeps),
      createInvitation: createCreateInvitation(invitationsDeps),
      revokeInvitation: createRevokeInvitation(invitationsDeps),
      acceptInvitation: createAcceptInvitation(invitationsDeps),
      addGuest: createAddGuestMember(membersDeps),
      changeMemberRole: createChangeMemberRole(membersDeps),
    },
    categories: {
      listCategories: createListCategories(categoriesDeps),
      createCategoryGroup: createCreateCategoryGroup(categoriesDeps),
      renameCategoryGroup: createRenameCategoryGroup(categoriesDeps),
      createCategory: createCreateCategory(categoriesDeps),
      updateCategory: createUpdateCategory(categoriesDeps),
      // HU-E3-03: soft-deleted transactions still count as references (D8).
      deleteCategory: createDeleteCategory({ ...categoriesDeps, usage: ledgerQueries }),
      archiveCategory: createArchiveCategory(categoriesDeps),
      restoreCategory: createRestoreCategory(categoriesDeps),
      archiveCategoryGroup: createArchiveCategoryGroup(categoriesDeps),
    },
    accounts: {
      createAccount: createCreateAccount(accountsDeps),
      updateAccount: createUpdateAccount(accountsDeps),
      archiveAccount: createArchiveAccount(accountsDeps),
      listAccounts: createListAccounts(accountsDeps),
      getAccount,
    },
    ledger: {
      recordExpense: createRecordExpense(ledgerDeps),
      recordIncome: createRecordIncome(ledgerDeps),
      recordTransfer: createRecordTransfer(ledgerDeps),
      listTransactions: createListTransactions(ledgerDeps),
      getTransaction: createGetTransaction(ledgerDeps),
      editTransaction: createEditTransaction(ledgerDeps),
      deleteTransaction: createDeleteTransaction(ledgerDeps),
      listAudit: createListAudit(ledgerDeps),
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
