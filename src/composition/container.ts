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
  createGetMemberNetBalance,
  createGetMemberNetBalances,
  createGetSettlementSuggestions,
  createGetSpaceBalances,
  createGetMemberBalanceHistory,
  type GetMemberBalanceHistory,
  type GetSettlementSuggestions,
  type GetSpaceBalances,
} from "@/modules/balances/application";
import {
  createCreateBudgetPlan,
  createGetBudgetPlan,
  createSetMemberCapacities,
  createSuggestCapacity,
  createAddBudgetLine,
  createRemoveBudgetLine,
  createUpdateBudgetLine,
  createMapCategoriesToLine,
  createAllocateBudgetLine,
  createActivateBudgetPlan,
  createCloseBudgetPlan,
  createClosedPeriodGuard,
  type ActivateBudgetPlan,
  type CloseBudgetPlan,
  createCopyBudgetPlan,
  type CopyBudgetPlan,
  createResolveDefaultSplit,
  type ResolveDefaultSplit,
  defaultSplitOf,
  type CreateBudgetPlan,
  type GetBudgetPlan,
  type PreviousIncome,
  type SetMemberCapacities,
  type SuggestCapacity,
  type AddBudgetLine,
  type RemoveBudgetLine,
  type SavingsAccountReader,
  type UpdateBudgetLine,
  type BudgetCategories,
  type MapCategoriesToLine,
  type AllocateBudgetLine,
} from "@/modules/budgeting/application";
import { DrizzleBudgetPlanRepository } from "@/modules/budgeting/infrastructure/drizzle-budget-plan-repository";
import {
  createDeleteTransaction,
  createEditTransaction,
  createGetTransaction,
  createListAudit,
  createListTransactions,
  createRecordExpense,
  createRecordExpenseByCategoryKey,
  createRecordFundContribution,
  createRecordIncome,
  createRecordSettlement,
  createRecordTransfer,
  createDefineRecurrence,
  type DefineRecurrence,
  type RecurrenceDeps,
  createGetRecurrence,
  createListRecurrences,
  createListUpcomingOccurrences,
  type GetRecurrence,
  type ListRecurrences,
  type ListUpcomingOccurrences,
  createUpdateRecurrence,
  type UpdateRecurrence,
  createEndRecurrence,
  createPauseRecurrence,
  createResumeRecurrence,
  type EndRecurrence,
  type PauseRecurrence,
  type ResumeRecurrence,
  createMaterializeDueOccurrences,
  occurrenceRecorders,
  type MaterializeDeps,
  type MaterializeDueOccurrences,
  createListPendingOccurrences,
  createSkipOccurrence,
  type ListPendingOccurrences,
  type SkipOccurrence,
  createConfirmOccurrence,
  type ConfirmOccurrence,
  type DeleteTransaction,
  type EditTransaction,
  type GetTransaction,
  type LedgerDeps,
  type ListAudit,
  type ListTransactions,
  type RecordExpense,
  type RecordedExpense,
  type RecordFundContribution,
  type RecordIncome,
  type RecordSettlement,
  type RecordTransfer,
} from "@/modules/ledger/application";
import { DrizzleAuditLog } from "@/modules/ledger/infrastructure/drizzle-audit-log";
import { DrizzleLedgerQueries } from "@/modules/ledger/infrastructure/drizzle-ledger-queries";
import { DrizzleTransactionRepository } from "@/modules/ledger/infrastructure/drizzle-transaction-repository";
import { DrizzleRecurrenceRepository } from "@/modules/ledger/infrastructure/drizzle-recurrence-repository";
import type { DirectSplitExpense } from "@/modules/ledger/contracts/ledger.contract";
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
  createUpdateProfile,
  type SignIn,
  type SignOut,
  type SignUp,
  type UpdateProfile,
} from "@/modules/identity/application";
import { createAuth } from "@/modules/identity/infrastructure/better-auth";
import { BetterAuthProvider } from "@/modules/identity/infrastructure/better-auth-provider";
import { DrizzleUserProfiles } from "@/modules/identity/infrastructure/drizzle-user-profiles";
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
  createArchiveSpace,
  createSplitWithPerson,
  createRemoveGuestMember,
  createClaimGuestPlace,
  createCreateGuestClaim,
  createLeaveSpace,
  type AcceptInvitation,
  type AddGuestMember,
  type ChangeMemberRole,
  type ClaimGuestPlace,
  type ClaimsDeps,
  type CreateGuestClaim,
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
  type ArchiveSpace,
  type SplitWithPerson,
  type RemoveGuestMember,
  type LeaveSpace,
  type LifecycleDeps,
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
import { isUuid, map, type AuthUser, type Clock, type Result } from "@/shared/kernel";
import { accountBalancesFrom } from "./account-balances";

/** Process-wide dependencies, built once from the environment. */
export interface Container extends RouteDeps {
  readonly db: Database;
  readonly pool: Pool;
  readonly tm: DrizzleTransactionManager;
  readonly idempotency: IdempotencyDeps;
  readonly identity: {
    readonly signUp: SignUp;
    readonly signIn: SignIn;
    readonly signOut: SignOut;
    readonly updateProfile: UpdateProfile;
  };
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
    readonly archiveSpace: ArchiveSpace;
    readonly splitWithPerson: SplitWithPerson<DirectSplitExpense, RecordedExpense>;
    readonly removeGuest: RemoveGuestMember;
    readonly createGuestClaim: CreateGuestClaim;
    readonly claimGuestPlace: ClaimGuestPlace;
    readonly leaveSpace: LeaveSpace;
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
    readonly recordFundContribution: RecordFundContribution;
    readonly recordSettlement: RecordSettlement;
    readonly listTransactions: ListTransactions;
    readonly getTransaction: GetTransaction;
    readonly editTransaction: EditTransaction;
    readonly deleteTransaction: DeleteTransaction;
    readonly listAudit: ListAudit;
    readonly defineRecurrence: DefineRecurrence;
    readonly listRecurrences: ListRecurrences;
    readonly getRecurrence: GetRecurrence;
    readonly listUpcomingOccurrences: ListUpcomingOccurrences;
    readonly updateRecurrence: UpdateRecurrence;
    readonly pauseRecurrence: PauseRecurrence;
    readonly resumeRecurrence: ResumeRecurrence;
    readonly endRecurrence: EndRecurrence;
    readonly materializeDueOccurrences: MaterializeDueOccurrences;
    readonly listPendingOccurrences: ListPendingOccurrences;
    readonly skipOccurrence: SkipOccurrence;
    readonly confirmOccurrence: ConfirmOccurrence;
  };
  readonly balances: {
    readonly getSpaceBalances: GetSpaceBalances;
    readonly getSettlementSuggestions: GetSettlementSuggestions;
    readonly getMemberBalanceHistory: GetMemberBalanceHistory;
  };
  readonly budgeting: {
    readonly createPlan: CreateBudgetPlan;
    readonly copyPlan: CopyBudgetPlan;
    readonly getPlan: GetBudgetPlan;
    readonly setCapacities: SetMemberCapacities;
    readonly suggestCapacity: SuggestCapacity;
    readonly addLine: AddBudgetLine;
    readonly updateLine: UpdateBudgetLine;
    readonly removeLine: RemoveBudgetLine;
    readonly mapCategories: MapCategoriesToLine;
    readonly allocateLine: AllocateBudgetLine;
    readonly activatePlan: ActivateBudgetPlan;
    readonly closePlan: CloseBudgetPlan;
    readonly resolveDefaultSplit: ResolveDefaultSplit;
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
  /** Test seam: replaces the system clock, so a test decides what "today" is (a plan closes only after its period). */
  readonly clock?: Clock;
}

export const buildContainer = (env: Env, options: ContainerOptions = {}): Container => {
  const { db, pool } = createDatabase(env.DATABASE_URL);
  const tm = new DrizzleTransactionManager(db);
  const ids = new UuidV7IdGenerator();
  const clock = options.clock ?? new SystemClock();
  const provider = new BetterAuthProvider(
    createAuth({
      db,
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      defaultTimeZone: env.APP_TIMEZONE,
    }),
    db,
    env.APP_TIMEZONE,
  );
  // HU-E1-14: every user's own zone; the ledger and accounts read it through the kernel's UserTimeZones.
  const profiles = new DrizzleUserProfiles(tm, env.APP_TIMEZONE);
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
  // HU-E6-01, D10: plans store their period boundaries; periods without a plan follow the space policy.
  const budgetPlans = new DrizzleBudgetPlanRepository(tm);
  const storedPeriods: StoredPeriodSource = (spaceId) => budgetPlans.storedPeriods(spaceId);
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
    // HU-E4-06, HU-E6-07: a CLOSED plan's period takes no change; budgeting answers, the ledger never imports it.
    closedPeriods: createClosedPeriodGuard(budgetPlans),
    // HU-E6-08, spec 5.3: an expense recorded without a split follows its line's allocation in the ACTIVE plan;
    // the ledger asks budgeting through its own port, so neither module imports the other.
    defaultSplits: {
      allocationWeights: async (expense) => {
        const split = await defaultSplitOf({ plans: budgetPlans }, expense);
        return split.method === "BY_ALLOCATION" ? split.weights : null;
      },
    },
    storedPeriods,
    // HU-E4-10: the accounts module owns the balance formula (opening balance + movements, HU-E2-04).
    accountBalances: accountBalancesFrom(getAccount),
    // HU-E1-14, HU-E4-14: each recorder's own zone; the ledger never imports identity.
    userTimeZones: profiles,
    ids,
    clock,
    timeZone: env.APP_TIMEZONE,
    tm,
  };
  const recordExpense = createRecordExpense(ledgerDeps);
  // HU-E4-11 … HU-E4-13: recurrences live in the ledger and record through its own use cases (ruling P21).
  const recurrenceRepository = new DrizzleRecurrenceRepository(tm);
  const recurrenceDeps: RecurrenceDeps = {
    ...ledgerDeps,
    recurrences: recurrenceRepository,
    occurrences: recurrenceRepository,
  };
  // HU-E4-12, HU-E4-13: the scheduler's job and confirmations record through the ledger's own use cases (P21).
  const materializeDeps: MaterializeDeps = { ...recurrenceDeps, recorders: occurrenceRecorders(ledgerDeps) };
  // HU-E1-13: a client cannot know a new direct space's category ids, so it names a catalog key (D11).
  const recordExpenseByCategoryKey = createRecordExpenseByCategoryKey(
    {
      access,
      categoryKeys: {
        findByKey: async (spaceId, key) => {
          const category = (await categoriesDeps.categories.listCategories(spaceId)).find(
            (c) => c.key === key,
          );
          return category ? { id: category.id, archived: category.archivedAt !== null } : null;
        },
      },
    },
    recordExpense,
  );
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
  // HU-E5-01 GetMemberNetBalance: spaces reads balances through a port, since balances imports spaces.
  const lifecycleDeps: LifecycleDeps = {
    access,
    members: spaceRepository,
    netBalance: createGetMemberNetBalance(ledgerQueries),
    clock,
    tm,
  };
  // D17: only the caller's own personal-space income is ever read for a capacity suggestion.
  const previousIncome: PreviousIncome = async (userId, from, to) => {
    const personal = (await spaceRepository.listForUser(userId)).find((s) => s.kind === "PERSONAL");
    if (!personal) return null;
    const { income } = await ledgerQueries.totals({ spaceId: personal.id, from, to });
    return { amount: income, currency: personal.currency };
  };
  // HU-E6-03: SAVINGS lines name their callers' own savings accounts, which live in their personal spaces (D9).
  const savingsAccounts: SavingsAccountReader = {
    find: async (accountId) => {
      // Ids come from request bodies; the port answers null for anything that is not a UUID.
      if (!isUuid(accountId)) return null;
      const account = await accountsDeps.accounts.findById(accountId);
      // A shared fund has no owner, so no line names it. An owned account follows its owner's currency: it lives in
      // the owner's personal space (HU-E2-01), where the owner is always a member.
      if (!account || account.ownerUserId === null) return null;
      const home = await spaceRepository.findMembership(account.spaceId, account.ownerUserId);
      return home
        ? {
            id: account.id,
            ownerUserId: account.ownerUserId,
            isSavings: account.type === "SAVINGS",
            archived: account.archivedAt !== null,
            currency: home.currency,
          }
        : null;
    },
  };
  // HU-E6-04: plans map the space's live categories; deleted ones never appear (D8).
  const budgetCategories: BudgetCategories = {
    list: async (spaceId) =>
      (await categoriesDeps.categories.listCategories(spaceId)).map((c) => ({
        id: c.id,
        archived: c.archivedAt !== null,
      })),
  };
  // HU-E6-01 … HU-E6-05: plans reach members, accounts, categories and the ledger's spending only through ports.
  const budgetingDeps = {
    access,
    members: spaceRepository,
    plans: budgetPlans,
    allocations: budgetPlans,
    statuses: budgetPlans,
    mappings: budgetPlans,
    categories: budgetCategories,
    lines: budgetPlans,
    savingsAccounts,
    capacities: budgetPlans,
    previousIncome,
    spending: ledgerQueries,
    ids,
    clock,
    timeZone: env.APP_TIMEZONE,
    tm,
  };
  const invitationRepository = new DrizzleInvitationRepository(tm);
  const invitationsDeps: InvitationsDeps = {
    access,
    members: spaceRepository,
    spaces: spaceRepository,
    invitations: invitationRepository,
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
  // HU-E1-11: claim links share the invitation store and tokens; the URL carries only the token.
  const claimsDeps: ClaimsDeps = {
    access,
    members: spaceRepository,
    claims: spaceRepository,
    invitations: invitationRepository,
    tokens: cryptoInvitationTokens,
    claimUrl: (token) => new URL(`/claims/${token}`, env.BETTER_AUTH_URL).toString(),
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
      signUp: createSignUp({ auth: provider, provisionUser, profiles, defaultTimeZone: env.APP_TIMEZONE }),
      updateProfile: createUpdateProfile({ profiles }),
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
          // D6: a plan's capacities and lines are amounts in the space currency too (HU-E6-01).
          hasMoneyRecords: async (spaceId) =>
            (await accountsDeps.accounts.listBySpace(spaceId)).length > 0 ||
            (await ledgerQueries.hasTransactions(spaceId)) ||
            (await budgetPlans.hasPlans(spaceId)),
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
      // HU-E1-09: every current member's net from one aggregate (balances' GetMemberNetBalances).
      archiveSpace: createArchiveSpace({
        ...lifecycleDeps,
        spaces: spaceRepository,
        netBalances: createGetMemberNetBalances(ledgerQueries),
      }),
      splitWithPerson: createSplitWithPerson<DirectSplitExpense, RecordedExpense>({
        access,
        spaces: spaceRepository,
        direct: spaceRepository,
        onCreated: onSpaceCreated,
        recordExpense: ({ spaceId, userId, expense }) =>
          recordExpenseByCategoryKey({ spaceId, userId, ...expense }),
        ids,
        clock,
        tm,
      }),
      removeGuest: createRemoveGuestMember({ ...lifecycleDeps, invitations: invitationRepository }),
      createGuestClaim: createCreateGuestClaim(claimsDeps),
      claimGuestPlace: createClaimGuestPlace(claimsDeps),
      leaveSpace: createLeaveSpace(lifecycleDeps),
    },
    categories: {
      listCategories: createListCategories(categoriesDeps),
      createCategoryGroup: createCreateCategoryGroup(categoriesDeps),
      renameCategoryGroup: createRenameCategoryGroup(categoriesDeps),
      createCategory: createCreateCategory(categoriesDeps),
      updateCategory: createUpdateCategory(categoriesDeps),
      // HU-E3-03: soft-deleted transactions and every budget-line mapping, ended ones included, are references (D8).
      deleteCategory: createDeleteCategory({
        ...categoriesDeps,
        usage: {
          isCategoryReferenced: async (categoryId) =>
            (await ledgerQueries.isCategoryReferenced(categoryId)) ||
            (await budgetPlans.isCategoryMapped(categoryId)),
        },
      }),
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
      recordExpense,
      recordIncome: createRecordIncome(ledgerDeps),
      recordTransfer: createRecordTransfer(ledgerDeps),
      recordFundContribution: createRecordFundContribution(ledgerDeps),
      recordSettlement: createRecordSettlement(ledgerDeps),
      listTransactions: createListTransactions(ledgerDeps),
      getTransaction: createGetTransaction(ledgerDeps),
      editTransaction: createEditTransaction(ledgerDeps),
      deleteTransaction: createDeleteTransaction(ledgerDeps),
      listAudit: createListAudit(ledgerDeps),
      defineRecurrence: createDefineRecurrence(recurrenceDeps),
      listRecurrences: createListRecurrences(recurrenceDeps),
      getRecurrence: createGetRecurrence(recurrenceDeps),
      listUpcomingOccurrences: createListUpcomingOccurrences(recurrenceDeps),
      updateRecurrence: createUpdateRecurrence(recurrenceDeps),
      pauseRecurrence: createPauseRecurrence(recurrenceDeps),
      resumeRecurrence: createResumeRecurrence(recurrenceDeps),
      endRecurrence: createEndRecurrence(recurrenceDeps),
      materializeDueOccurrences: createMaterializeDueOccurrences(materializeDeps),
      listPendingOccurrences: createListPendingOccurrences(recurrenceDeps),
      skipOccurrence: createSkipOccurrence(recurrenceDeps),
      confirmOccurrence: createConfirmOccurrence(materializeDeps),
    },
    balances: {
      // HU-E5-01: the ledger aggregates per-member totals in SQL (D7); the balances module nets them.
      getSpaceBalances: createGetSpaceBalances({ access, members: spaceRepository, source: ledgerQueries }),
      // HU-E5-04: a member's running net, movement by movement, from one SQL window function (D7).
      getMemberBalanceHistory: createGetMemberBalanceHistory({
        access,
        members: spaceRepository,
        history: ledgerQueries,
      }),
      // HU-E5-03: suggestions are computed on read from the same balances (D7).
      getSettlementSuggestions: createGetSettlementSuggestions({
        access,
        members: spaceRepository,
        source: ledgerQueries,
      }),
    },
    budgeting: {
      createPlan: createCreateBudgetPlan(budgetingDeps),
      copyPlan: createCopyBudgetPlan(budgetingDeps),
      getPlan: createGetBudgetPlan(budgetingDeps),
      setCapacities: createSetMemberCapacities(budgetingDeps),
      suggestCapacity: createSuggestCapacity(budgetingDeps),
      addLine: createAddBudgetLine(budgetingDeps),
      updateLine: createUpdateBudgetLine(budgetingDeps),
      removeLine: createRemoveBudgetLine(budgetingDeps),
      mapCategories: createMapCategoriesToLine(budgetingDeps),
      allocateLine: createAllocateBudgetLine(budgetingDeps),
      activatePlan: createActivateBudgetPlan(budgetingDeps),
      closePlan: createCloseBudgetPlan(budgetingDeps),
      resolveDefaultSplit: createResolveDefaultSplit(budgetingDeps),
    },
    authThrottle: {
      // Both counters advance on every attempt, so neither can be probed independently.
      signIn: (ip, email) => [signInByIp.hit(ip), signInByEmail.hit(email)].every(Boolean),
      signUp: (ip) => signUpByIp.hit(ip),
    },
  };
};

/**
 * The process-wide container lives on `globalThis`, not in this module: Next.js bundles `instrumentation.ts`, which
 * starts the recurring-transactions job (HU-E4-12), apart from the route handlers, so each loads its own copy of this
 * module, and a module-level variable would give the process two containers and two database pools.
 */
const CONTAINER = Symbol.for("hearth.container");
const shared = globalThis as { [CONTAINER]?: Container };

export const getContainer = (): Container => (shared[CONTAINER] ??= buildContainer(loadEnv()));

export const setContainerForTests = (next: Container | undefined): void => {
  shared[CONTAINER] = next;
};
