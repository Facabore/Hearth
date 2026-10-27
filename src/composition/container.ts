import type { Pool } from "pg";
import {
  createArchiveAccount,
  createCreateAccount,
  createGetAccount,
  createListAccounts,
  createRestoreAccount,
  createSeedStarterAccounts,
  createUpdateAccount,
  holdsMoney,
  switchesOf,
  type AccountsDeps,
  type ArchiveAccount,
  type CreateAccount,
  type GetAccount,
  type ListAccounts,
  type RestoreAccount,
  type SeedStarterAccounts,
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
  createGetFundContributions,
  createGetLineDashboard,
  createGetMemberLineMatrix,
  createGetCashFlow,
  type GetCashFlow,
  type GetFundContributions,
  createGetUnifiedPersonalView,
  type GetUnifiedPersonalView,
  createGetLineTrend,
  type GetLineTrend,
  createGetPersonalTrend,
  type GetPersonalTrend,
  createGetSpendingByGroup,
  type GetSpendingByGroup,
  createGetPersonalSpendingByGroup,
  type GetPersonalSpendingByGroup,
  type GetLineDashboard,
  type GetMemberLineMatrix,
} from "@/modules/reporting/application";
import {
  createConvertTransaction,
  createDeleteTransaction,
  createRestoreTransaction,
  createUndoConversion,
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
  createListScheduledMovements,
  createExtendRecurrence,
  createPauseRecurrence,
  createResumeRecurrence,
  type EndRecurrence,
  type ExtendRecurrence,
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
  type RestoreTransaction,
  type ConvertTransaction,
  type UndoConversion,
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
  createGetProfile,
  createSignIn,
  createSignOut,
  createSignUp,
  createUpdateProfile,
  type GetProfile,
  type InstallationRulesReader,
  type SignIn,
  type SignOut,
  type SignUp,
  type UpdateProfile,
} from "@/modules/identity/application";
import { createAuth } from "@/modules/identity/infrastructure/better-auth";
import { BetterAuthProvider } from "@/modules/identity/infrastructure/better-auth-provider";
import { BuiltInInstallationRules } from "@/modules/identity/infrastructure/built-in-installation-rules";
import { DrizzleUserProfiles } from "@/modules/identity/infrastructure/drizzle-user-profiles";
import {
  createAcceptInvitation,
  createAddGuestMember,
  createChangeMemberRole,
  createCreateInvitation,
  createCreatePersonalSpace,
  createCreateSpace,
  createGetSpace,
  createListInvitations,
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
  createInvitationAdmitsSignUp,
  createCreateGuestClaim,
  createLeaveSpace,
  createPreviewClaim,
  createPreviewInvitation,
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
  type ListInvitations,
  type ListMembers,
  type ListMySpaces,
  type ListSpacePeriods,
  type MembersDeps,
  type PreviewClaim,
  type PreviewInvitation,
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
import { createFixedWindowLimiter, leveledLogger, type IdempotencyDeps, type RouteDeps } from "@/shared/http";
import { createDatabase, type Database } from "@/shared/infrastructure/db/client";
import { reachableWithin } from "@/shared/infrastructure/db/reachable";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { DrizzleIdempotencyStore } from "@/shared/infrastructure/drizzle-idempotency-store";
import { loadEnv, type Env } from "@/shared/infrastructure/env";
import { clockFrom } from "@/shared/infrastructure/system-clock";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { isUuid, map, type AuthUser, type Clock, type Result } from "@/shared/kernel";
import { accountBalancesFrom } from "./account-balances";

/** Process-wide dependencies, built once from the environment. */
export interface Container extends RouteDeps {
  readonly db: Database;
  readonly pool: Pool;
  readonly tm: DrizzleTransactionManager;
  /** HU-E8-02: whether PostgreSQL answers a trivial query now. */
  readonly databaseReachable: () => Promise<boolean>;
  readonly idempotency: IdempotencyDeps;
  readonly identity: {
    readonly signUp: SignUp;
    /** Ruling P143: HEARTH_SIGN_UP, as `GET /api/v1/auth/sign-up` answers it. */
    readonly signUpMode: "open" | "closed";
    readonly signIn: SignIn;
    readonly signOut: SignOut;
    readonly updateProfile: UpdateProfile;
    readonly getProfile: GetProfile;
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
    readonly listInvitations: ListInvitations;
    readonly acceptInvitation: AcceptInvitation;
    readonly previewInvitation: PreviewInvitation;
    readonly previewClaim: PreviewClaim;
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
    readonly restoreAccount: RestoreAccount;
    /** Issue 169: the personal space's starter accounts its empty state offers. */
    readonly createStarterAccounts: SeedStarterAccounts;
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
    readonly restoreTransaction: RestoreTransaction;
    /** Issue #195: an expense, income or transfer becomes another of the three, and back. */
    readonly convertTransaction: ConvertTransaction;
    readonly undoConversion: UndoConversion;
    readonly listAudit: ListAudit;
    readonly defineRecurrence: DefineRecurrence;
    readonly listRecurrences: ListRecurrences;
    readonly getRecurrence: GetRecurrence;
    readonly listUpcomingOccurrences: ListUpcomingOccurrences;
    readonly updateRecurrence: UpdateRecurrence;
    readonly pauseRecurrence: PauseRecurrence;
    readonly resumeRecurrence: ResumeRecurrence;
    readonly endRecurrence: EndRecurrence;
    readonly extendRecurrence: ExtendRecurrence;
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
  readonly reporting: {
    readonly getLineDashboard: GetLineDashboard;
    readonly getMemberLineMatrix: GetMemberLineMatrix;
    readonly getFundContributions: GetFundContributions;
    readonly getUnifiedPersonalView: GetUnifiedPersonalView;
    readonly getLineTrend: GetLineTrend;
    readonly getPersonalTrend: GetPersonalTrend;
    readonly getSpendingByGroup: GetSpendingByGroup;
    readonly getPersonalSpendingByGroup: GetPersonalSpendingByGroup;
    readonly getCashFlow: GetCashFlow;
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
/** The installation's built-in language until HU-E8-18 stores one (HU-E9-13, ruling P124). */
const INSTALLATION_DEFAULT_LOCALE = "es";
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
  /** Test seam: the installation's defaults and locks (HU-E1-15); the built-in es-CO rules until HU-E8-18. */
  readonly installationRules?: InstallationRulesReader;
}

export const buildContainer = (env: Env, options: ContainerOptions = {}): Container => {
  const { db, pool } = createDatabase(env.DATABASE_URL);
  const tm = new DrizzleTransactionManager(db);
  const ids = new UuidV7IdGenerator();
  const clock = options.clock ?? clockFrom(env.HEARTH_E2E_FIXED_NOW);
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
  // HU-E1-15: the installation's defaults and locks; HU-E8-18 binds its stored rules here.
  const installationRules = options.installationRules ?? new BuiltInInstallationRules();
  const spaceRepository = new DrizzleSpaceRepository(tm);
  const access = createSpaceAccess(spaceRepository);
  const categoryRepository = new DrizzleCategoryRepository(tm);
  const categoriesDeps: CategoriesDeps = {
    categories: categoryRepository,
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
    // HU-E1-14, HU-E2-06: the requester's today for next billing dates; accounts never import identity.
    userTimeZones: profiles,
    tm,
  };
  // HU-E6-01, D10: plans store their period boundaries; periods without a plan follow the space policy.
  const budgetPlans = new DrizzleBudgetPlanRepository(tm);
  const storedPeriods: StoredPeriodSource = (spaceId) => budgetPlans.storedPeriods(spaceId);
  const getAccount = createGetAccount(accountsDeps);
  const listAccounts = createListAccounts(accountsDeps);
  // HU-E6-04: plans map the space's live categories; deleted ones never appear (D8).
  const budgetCategories: BudgetCategories = {
    list: async (spaceId) =>
      (await categoriesDeps.categories.listCategories(spaceId)).map((c) => ({
        id: c.id,
        archived: c.archivedAt !== null,
        parentCategoryId: c.parentCategoryId,
      })),
  };
  const ledgerDeps: LedgerDeps = {
    access,
    // Issue #89: money writes hold the space row FOR SHARE; leaving, removing and archiving hold it FOR NO KEY UPDATE.
    spaceLocks: spaceRepository,
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
      // HU-E3-04: the filter's subcategories; listCategories skips deleted rows and keeps archived ones.
      subcategoriesOf: async (spaceId, categoryIds) =>
        (await categoriesDeps.categories.listCategories(spaceId))
          .filter((c) => c.parentCategoryId !== null && categoryIds.includes(c.parentCategoryId))
          .map((c) => c.id),
    },
    // HU-E4-06, HU-E6-07: a CLOSED plan's period takes no change; budgeting answers, the ledger never imports it.
    closedPeriods: createClosedPeriodGuard(budgetPlans),
    // HU-E6-08, spec 5.3: an expense recorded without a split follows its line's allocation in the ACTIVE plan;
    // the ledger asks budgeting through its own port, so neither module imports the other.
    defaultSplits: {
      allocationWeights: async (expense) => {
        const split = await defaultSplitOf({ plans: budgetPlans, categories: budgetCategories }, expense);
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
  const recordIncome = createRecordIncome(ledgerDeps);
  const recordTransfer = createRecordTransfer(ledgerDeps);
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
      spaceLocks: spaceRepository,
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
  // Issue 169: starter accounts at zero, so a new person can record from minute one.
  const seedStarterAccounts = createSeedStarterAccounts(accountsDeps);
  // HU-E3-01: default categories in the creator's locale, seeded in the same transaction as the space; issue 169: a
  // personal space (only sign-up creates one) also gets its starter accounts in that transaction and locale.
  const onSpaceCreated: SpaceCreatedListener = async (space, { locale }) => {
    const seeded = await seedDefaultCategories({ spaceId: space.id, locale });
    if (!seeded.ok || space.kind !== "PERSONAL" || space.personalOwnerUserId === null) return seeded;
    return map(
      await seedStarterAccounts({ spaceId: space.id, userId: space.personalOwnerUserId, locale }),
      () => undefined,
    );
  };
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
    spaceLocks: spaceRepository,
    members: spaceRepository,
    netBalance: createGetMemberNetBalance(ledgerQueries),
    clock,
    tm,
  };
  // HU-E1-02: the user's personal space, created at sign-up; undefined only for a user without one.
  const personalSpaceOf = async (userId: string) =>
    (await spaceRepository.listForUser(userId)).find((s) => s.kind === "PERSONAL");
  // D17: only the caller's own personal-space income is ever read for a capacity suggestion.
  const previousIncome: PreviousIncome = async (userId, from, to) => {
    const personal = await personalSpaceOf(userId);
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
  // HU-E7-04 (ruling P37): the caller's own SAVINGS accounts live in their personal space (HU-E2-01), archived too.
  const savingsAccountsOf = async (userId: string): Promise<string[]> => {
    const personal = await personalSpaceOf(userId);
    if (!personal) return [];
    const accounts = await accountsDeps.accounts.listBySpace(personal.id);
    // Defensive: a personal space only holds its owner's accounts, so the owner filter never drops one today.
    return accounts.filter((a) => a.type === "SAVINGS" && a.ownerUserId === userId).map((a) => a.id);
  };
  // HU-E7-01 … HU-E7-05: reports read budgeting's figures and the ledger's sums through ports, on read (D7, P32).
  const reportingDeps = {
    // HU-E7-06: the category trees as they stand now, with group and category keys (categories, P74).
    trees: categoryRepository,
    // HU-E7-04: the caller's own member rows (spaces), category keys (catalog) and savings accounts (accounts).
    places: spaceRepository,
    catalog: categoriesDeps.categories,
    savingsAccountsOf,
    // HU-E7-02, HU-E7-03: the ledger sums payments, shares and fund contributions per member in SQL (D7).
    sums: ledgerQueries,
    access,
    members: spaceRepository,
    plans: budgetPlans,
    spending: ledgerQueries,
    savingsAccounts,
    categories: budgetCategories,
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
    logger: leveledLogger(env.LOG_LEVEL),
    // HU-E8-02: the health check's database probe; a failure, or no answer within 2 s, reads as unreachable.
    databaseReachable: () => reachableWithin(2_000, () => pool.query("SELECT 1")),
    sessionResolver: provider,
    idempotency: { tm, store: new DrizzleIdempotencyStore(tm) },
    identity: {
      signUp: createSignUp({
        auth: provider,
        provisionUser,
        profiles,
        defaultTimeZone: env.APP_TIMEZONE,
        // Ruling P143: identity never imports spaces, so a closed installation asks the invitations through this port.
        signUpGate: { mode: env.HEARTH_SIGN_UP, admits: createInvitationAdmitsSignUp(invitationsDeps) },
      }),
      signUpMode: env.HEARTH_SIGN_UP,
      updateProfile: createUpdateProfile({ profiles, rules: installationRules }),
      // HU-E9-13, ruling P124: the installation's zone and, until HU-E8-18 stores one, its built-in language.
      getProfile: createGetProfile({
        profiles,
        rules: installationRules,
        regionDefaults: { timezone: env.APP_TIMEZONE, locale: INSTALLATION_DEFAULT_LOCALE },
      }),
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
          // D6: a plan's capacities and lines are amounts in the space currency too (HU-E6-01). Issue 169: an account
          // records money only when it holds an amount, so sign-up's starter accounts at zero never lock the currency;
          // an account's currency is its space's (no column of its own), so they follow a change with nothing to move.
          // A recurrence stores its amount with its own currency and records its occurrences in it; an ended one counts
          // too, since it keeps that amount and can be extended again (#115).
          hasMoneyRecords: async (spaceId) =>
            (await accountsDeps.accounts.listBySpace(spaceId)).some(holdsMoney) ||
            (await recurrenceRepository.list(spaceId)).length > 0 ||
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
      listInvitations: createListInvitations(invitationsDeps),
      acceptInvitation: createAcceptInvitation(invitationsDeps),
      previewInvitation: createPreviewInvitation(invitationsDeps),
      previewClaim: createPreviewClaim(invitationsDeps),
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
      restoreAccount: createRestoreAccount(accountsDeps),
      createStarterAccounts: seedStarterAccounts,
      listAccounts,
      getAccount,
    },
    ledger: {
      recordExpense,
      recordIncome,
      recordTransfer,
      recordFundContribution: createRecordFundContribution(ledgerDeps),
      recordSettlement: createRecordSettlement(ledgerDeps),
      listTransactions: createListTransactions(ledgerDeps),
      getTransaction: createGetTransaction(ledgerDeps),
      editTransaction: createEditTransaction(ledgerDeps),
      deleteTransaction: createDeleteTransaction(ledgerDeps),
      restoreTransaction: createRestoreTransaction(ledgerDeps),
      // Issue #195: the new movement is recorded through the ledger's own use cases, in the conversion's transaction.
      convertTransaction: createConvertTransaction(ledgerDeps, {
        recordExpense,
        recordIncome,
        recordTransfer,
      }),
      undoConversion: createUndoConversion(ledgerDeps),
      listAudit: createListAudit(ledgerDeps),
      defineRecurrence: createDefineRecurrence(recurrenceDeps),
      listRecurrences: createListRecurrences(recurrenceDeps),
      getRecurrence: createGetRecurrence(recurrenceDeps),
      listUpcomingOccurrences: createListUpcomingOccurrences(recurrenceDeps),
      updateRecurrence: createUpdateRecurrence(recurrenceDeps),
      pauseRecurrence: createPauseRecurrence(recurrenceDeps),
      resumeRecurrence: createResumeRecurrence(recurrenceDeps),
      endRecurrence: createEndRecurrence(recurrenceDeps),
      extendRecurrence: createExtendRecurrence(recurrenceDeps),
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
    reporting: {
      getLineDashboard: createGetLineDashboard(reportingDeps),
      getMemberLineMatrix: createGetMemberLineMatrix(reportingDeps),
      getFundContributions: createGetFundContributions(reportingDeps),
      getUnifiedPersonalView: createGetUnifiedPersonalView(reportingDeps),
      getLineTrend: createGetLineTrend(reportingDeps),
      getPersonalTrend: createGetPersonalTrend(reportingDeps),
      getSpendingByGroup: createGetSpendingByGroup(reportingDeps),
      getPersonalSpendingByGroup: createGetPersonalSpendingByGroup(reportingDeps),
      // #150, rulings P238–P240: the caller's own money across every space they belong to, on read (D7).
      getCashFlow: createGetCashFlow({
        clock,
        userTimeZones: profiles,
        spacesOf: async (userId) =>
          (await spaceRepository.listForUser(userId, { includeArchived: false })).map((space) => ({
            spaceId: space.id,
            name: space.name,
          })),
        scheduled: createListScheduledMovements({
          recurrences: recurrenceRepository,
          occurrences: recurrenceRepository,
        }),
        ownAccountsOf: async (userId) => {
          const personal = await personalSpaceOf(userId);
          // Sign-up provisions a personal space or compensates (HU-E1-02), so a signed-in user always has one.
          if (!personal) throw new Error(`user ${userId} has no personal space`);
          const listed = await listAccounts({ spaceId: personal.id, userId, includeArchived: false });
          if (!listed.ok) throw new Error(`own accounts unreadable: ${listed.error.code}`);
          return {
            currency: listed.value.currency,
            available: listed.value.totals.available,
            // Defensive: a personal space only holds its owner's accounts (no SHARED_FUND, HU-E2-02).
            accounts: listed.value.items
              .filter((account) => account.ownerUserId === userId)
              .map((account) => ({ id: account.id, counted: switchesOf(account).includeInAvailable })),
          };
        },
      }),
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
