import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { Pool } from "pg";
import {
  createArchiveAccount,
  createCreateAccount,
  createGetAccount,
  createListAccounts,
  createRestoreAccount,
  createSeedStarterAccounts,
  createChangeAccountCurrency,
  createPreviewAccountCurrency,
  createUpdateAccount,
  type ChangeAccountCurrency,
  type ChangeAccountCurrencyDeps,
  type PreviewAccountCurrency,
  holdsMoney,
  switchesOf,
  type AccountRepository,
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
import { accounts as accountsTable } from "@/modules/accounts/infrastructure/accounts.schema";
import {
  budgetLineCategories as budgetLineCategoriesTable,
  budgetLines as budgetLinesTable,
  budgetPlans as budgetPlansTable,
} from "@/modules/budgeting/infrastructure/budgeting.schema";
import { transactions as transactionsTable } from "@/modules/ledger/infrastructure/ledger.schema";
import { recurrences as recurrencesTable } from "@/modules/ledger/infrastructure/recurrences.schema";
import {
  createGetMemberNetBalance,
  createGetMemberNetBalances,
  createGetSettlementSuggestions,
  createGetSpaceBalances,
  createGetMemberBalanceHistory,
  createGetMyBalances,
  createGetMyFriend,
  createListMyFriends,
  createGetSettlementContexts,
  type GetMemberBalanceHistory,
  type GetMyBalances,
  type GetMyFriend,
  type ListMyFriends,
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
  type BudgetAccount,
  type SavingsAccountReader,
  type UpdateBudgetLine,
  type BudgetCategories,
  type MapCategoriesToLine,
  type AllocateBudgetLine,
  type PlanHistoryReader,
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
  createConvertAccountMovements,
  createEditTransaction,
  createGetTransaction,
  createListAudit,
  createListTransactions,
  createRecordExpense,
  createRecordExpenseByCategoryKey,
  createRecordFundContribution,
  createRecordIncome,
  createRecordPairSettlement,
  createRecordSettlement,
  createRecordTransfer,
  createRecordAdjustment,
  createDefineRecurrence,
  type DefineRecurrence,
  type RecurrenceDeps,
  createGetRecurrence,
  createListRecurrences,
  createListUpcomingOccurrences,
  createPreviewSchedule,
  type GetRecurrence,
  type ListRecurrences,
  type ListUpcomingOccurrences,
  type PreviewSchedule,
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
  createListMyPendingOccurrences,
  createListPendingOccurrences,
  createSkipOccurrence,
  type ListMyPendingOccurrences,
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
  type GetAccountUsage,
  type ListMyActivity,
  createGetAccountUsage,
  createListMyActivity,
  type ListMyTransactions,
  createListMyTransactions,
  type RecordExpense,
  type RecordedExpense,
  type RecordFundContribution,
  type RecordIncome,
  type RecordSettlement,
  type Transaction,
  type RecordTransfer,
  type RecordAdjustment,
} from "@/modules/ledger/application";
import { DrizzleAuditLog } from "@/modules/ledger/infrastructure/drizzle-audit-log";
import { DrizzleLedgerQueries } from "@/modules/ledger/infrastructure/drizzle-ledger-queries";
import { DrizzleTransactionRepository } from "@/modules/ledger/infrastructure/drizzle-transaction-repository";
import { DrizzleRecurrenceRepository } from "@/modules/ledger/infrastructure/drizzle-recurrence-repository";
import type {
  DirectSettlementTransfer,
  DirectSplitExpense,
} from "@/modules/ledger/contracts/ledger.contract";
import {
  createArchiveCategory,
  createArchiveCategoryGroup,
  createRestoreCategoryGroup,
  createCreateCategory,
  createCreateCategoryGroup,
  createDeleteCategory,
  createListCategories,
  createMoveCategoryGroup,
  createRenameCategoryGroup,
  createRestoreCategory,
  createSeedDefaultCategories,
  createUpdateCategory,
  type ArchiveCategory,
  type ArchiveCategoryGroup,
  type RestoreCategoryGroup,
  type CategoriesDeps,
  type CategoryRepository,
  type CategoryUsage,
  type CategoryUsageCounts,
  type CreateCategory,
  type CreateCategoryGroup,
  type DeleteCategory,
  type ListCategories,
  type MoveCategoryGroup,
  type RenameCategoryGroup,
  type RestoreCategory,
  type UpdateCategory,
} from "@/modules/categories/application";
import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";
import {
  createFindUserByHandle,
  createGetProfile,
  createSignIn,
  createSignOut,
  createSignUp,
  createUpdateProfile,
  parseHandle,
  type FindUserByHandle,
  createVerifyEmail,
  type GetProfile,
  type InstallationRulesReader,
  type SignIn,
  type SignOut,
  type SignUp,
  type UpdateProfile,
  type VerifyEmail,
} from "@/modules/identity/application";
import { createAuth } from "@/modules/identity/infrastructure/better-auth";
import { BetterAuthProvider } from "@/modules/identity/infrastructure/better-auth-provider";
import { BuiltInInstallationRules } from "@/modules/identity/infrastructure/built-in-installation-rules";
import { DrizzleUserProfiles } from "@/modules/identity/infrastructure/drizzle-user-profiles";
import {
  createClaimReferrer,
  createGetMyReferrals,
  createPreviewReferral,
  type ClaimReferrer,
  type GetMyReferrals,
  type PreviewReferral,
  type ReferralsDeps,
} from "@/modules/referrals/application";
import { cryptoReferralRandom } from "@/modules/referrals/infrastructure/crypto-referral-random";
import {
  createAdjustImport,
  createAuthorizeImport,
  createConfirmImport,
  createExportPersonData,
  createListImports,
  createRemoveExpiredSnapshots,
  createStartImport,
  createUndoImport,
  type AdjustImport,
  type AuthorizeImport,
  type ConfirmImport,
  type ExportPersonData,
  type ListImports,
  type RemoveExpiredSnapshots,
  type StartImport,
  type UndoImport,
} from "@/modules/portability/application";
import {
  DrizzleImportBatches,
  DrizzleImportLinks,
} from "@/modules/portability/infrastructure/drizzle-import-repositories";
import { createExportReader } from "@/modules/portability/infrastructure/export-reader";
import { createUseCaseImportWriter } from "@/modules/portability/infrastructure/use-case-import-writer";
import { createWorkerSnapshotReader } from "@/modules/portability/infrastructure/worker-snapshot-reader";
import { zipStored } from "@/modules/portability/infrastructure/zip-writer";
import type { ExchangeRateRepository } from "@/modules/rates/application";
import { DrizzleExchangeRates } from "@/modules/rates/infrastructure/drizzle-exchange-rates";
import { DrizzleReferrals } from "@/modules/referrals/infrastructure/drizzle-referrals";
import {
  createAcceptInvitation,
  createAddGuestMember,
  createAddGuestMembers,
  createChangeMemberRole,
  createCreateInvitation,
  createCreatePersonalSpace,
  createCreateSpace,
  createGetSpace,
  createListInvitations,
  createListMembers,
  createListMySpaces,
  createListSpacePeriods,
  createRestoreInvitation,
  createRevokeInvitation,
  createSpaceAccess,
  createUpdateSpaceSettings,
  createArchiveSpace,
  createSplitWithPeople,
  createSplitWithPerson,
  createStartDirectSpaceWithGuest,
  createRemoveGuestMember,
  createClaimGuestPlace,
  createInvitationAdmitsSignUp,
  createCreateGuestClaim,
  createLeaveSpace,
  createSetFriendNickname,
  createRemoveFriend,
  createSendFriendRequest,
  createListFriendRequests,
  createAcceptFriendRequest,
  createRejectFriendRequest,
  createPreviewClaim,
  createPreviewInvitation,
  type AcceptInvitation,
  type AddGuestMember,
  type AddGuestMembers,
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
  type SpaceUsage,
  type MembersDeps,
  type PreviewClaim,
  type PreviewInvitation,
  type RestoreInvitation,
  type RevokeInvitation,
  type SpaceCreatedListener,
  type StoredPeriodSource,
  type UpdateSpaceSettings,
  type ArchiveSpace,
  type SplitWithPeople,
  type SplitWithPersonDeps,
  type SplitWithPerson,
  type RemoveGuestMember,
  type LeaveSpace,
  type SetFriendNickname,
  type SendFriendRequest,
  type RemoveFriend,
  type StartDirectSpaceWithGuest,
  type ListFriendRequests,
  type AnswerFriendRequest,
  type FriendRequestsDeps,
  type SpaceId,
  type LifecycleDeps,
} from "@/modules/spaces/application";
import { cryptoInvitationTokens } from "@/modules/spaces/infrastructure/crypto-invitation-tokens";
import { DrizzleInvitationRepository } from "@/modules/spaces/infrastructure/drizzle-invitation-repository";
import { DrizzleFriendRequests } from "@/modules/spaces/infrastructure/drizzle-friend-requests";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import {
  spaceMembers as spaceMembersTable,
  spaces as spacesTable,
} from "@/modules/spaces/infrastructure/spaces.schema";
import { mailedInvitations } from "@/modules/spaces/infrastructure/mailed-invitations";
import { createFixedWindowLimiter, leveledLogger, type IdempotencyDeps, type RouteDeps } from "@/shared/http";
import { createDatabase, type Database, type Executor } from "@/shared/infrastructure/db/client";
import { createDatabaseProbe } from "@/shared/infrastructure/db/probe";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { DrizzleIdempotencyStore } from "@/shared/infrastructure/drizzle-idempotency-store";
import { createSmtpMailer, type Mailer } from "@/shared/infrastructure/email/smtp-mailer";
import { loadEnv, type Env } from "@/shared/infrastructure/env";
import { clockFrom } from "@/shared/infrastructure/system-clock";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { isUuid, map, type AuthUser, type Clock, type Result } from "@/shared/kernel";
import { accountMovementsOf } from "./account-movements";
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
    /** Issue #86: confirms an address from its verification link's token. */
    readonly verifyEmail: VerifyEmail;
    readonly updateProfile: UpdateProfile;
    readonly getProfile: GetProfile;
    /** P339: someone by their exact @usuario, throttled per person. */
    readonly findUserByHandle: FindUserByHandle;
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
    readonly restoreInvitation: RestoreInvitation;
    readonly listInvitations: ListInvitations;
    readonly acceptInvitation: AcceptInvitation;
    readonly previewInvitation: PreviewInvitation;
    readonly previewClaim: PreviewClaim;
    readonly addGuest: AddGuestMember;
    readonly addGuests: AddGuestMembers;
    readonly changeMemberRole: ChangeMemberRole;
    readonly archiveSpace: ArchiveSpace;
    readonly splitWithPerson: SplitWithPerson<DirectSplitExpense, RecordedExpense>;
    /** P331: an expense that was for several people, each part in its pair's direct space. */
    readonly splitWithPeople: SplitWithPeople<DirectSplitExpense, RecordedExpense>;
    /** P334: a transfer to or from one person, through their direct space (created on first use). */
    readonly settleWithPerson: SplitWithPerson<DirectSettlementTransfer, Transaction>;
    readonly removeGuest: RemoveGuestMember;
    readonly createGuestClaim: CreateGuestClaim;
    readonly claimGuestPlace: ClaimGuestPlace;
    readonly leaveSpace: LeaveSpace;
    /** P338: the viewer's apodo for the other member of a direct space (a guest's name). */
    readonly setFriendNickname: SetFriendNickname;
    /** P339: friend requests by @usuario; accepting creates the pair's direct space or reuses the active one. */
    readonly sendFriendRequest: SendFriendRequest;
    readonly listFriendRequests: ListFriendRequests;
    readonly acceptFriendRequest: AnswerFriendRequest<{ readonly spaceId: SpaceId }>;
    readonly rejectFriendRequest: AnswerFriendRequest<void>;
    /** P339 (S5): a friend who does not use Hearth, a guest in a new direct space with the person. */
    readonly addGuestFriend: StartDirectSpaceWithGuest;
    /** P339 (S7): archives a direct space once the pair is even; it leaves Amigos for both. */
    readonly removeFriend: RemoveFriend;
  };
  readonly categories: {
    readonly listCategories: ListCategories;
    readonly createCategoryGroup: CreateCategoryGroup;
    readonly renameCategoryGroup: RenameCategoryGroup;
    readonly moveCategoryGroup: MoveCategoryGroup;
    readonly createCategory: CreateCategory;
    readonly updateCategory: UpdateCategory;
    readonly deleteCategory: DeleteCategory;
    readonly archiveCategory: ArchiveCategory;
    readonly restoreCategory: RestoreCategory;
    readonly archiveCategoryGroup: ArchiveCategoryGroup;
    readonly restoreCategoryGroup: RestoreCategoryGroup;
  };
  readonly accounts: {
    readonly createAccount: CreateAccount;
    readonly updateAccount: UpdateAccount;
    /** Ruling P336: what changing an account's currency would do, and the change itself. */
    readonly previewAccountCurrency: PreviewAccountCurrency;
    readonly changeAccountCurrency: ChangeAccountCurrency;
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
    readonly recordAdjustment: RecordAdjustment;
    readonly recordFundContribution: RecordFundContribution;
    readonly recordSettlement: RecordSettlement;
    readonly listTransactions: ListTransactions;
    /** Ruling P306: the personal Inicio's feed of the caller's shared and direct spaces. */
    readonly listMyActivity: ListMyActivity;
    readonly getAccountUsage: GetAccountUsage;
    /** Ruling P319: the personal Movimientos, the caller's movements in every current space. */
    readonly listMyTransactions: ListMyTransactions;
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
    readonly previewSchedule: PreviewSchedule;
    readonly updateRecurrence: UpdateRecurrence;
    readonly pauseRecurrence: PauseRecurrence;
    readonly resumeRecurrence: ResumeRecurrence;
    readonly endRecurrence: EndRecurrence;
    readonly extendRecurrence: ExtendRecurrence;
    readonly materializeDueOccurrences: MaterializeDueOccurrences;
    readonly listPendingOccurrences: ListPendingOccurrences;
    readonly listMyPendingOccurrences: ListMyPendingOccurrences;
    readonly skipOccurrence: SkipOccurrence;
    readonly confirmOccurrence: ConfirmOccurrence;
  };
  readonly balances: {
    readonly getSpaceBalances: GetSpaceBalances;
    readonly getSettlementSuggestions: GetSettlementSuggestions;
    readonly getMemberBalanceHistory: GetMemberBalanceHistory;
    readonly getMyBalances: GetMyBalances;
    /** P338: Amigos, the other member of each direct space with the viewer's net and the last movement. */
    readonly listMyFriends: ListMyFriends;
    /** P339: one row of Amigos, as the list answers it. */
    readonly getMyFriend: GetMyFriend;
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
  /** D27: the person's referral link and points, a link's public preview and the claim after sign-up. */
  readonly referrals: {
    readonly getMine: GetMyReferrals;
    readonly preview: PreviewReferral;
    readonly claim: ClaimReferrer;
  };
  /** D28, design §3.6: the person's data export. */
  readonly portability: {
    readonly exportPersonData: ExportPersonData;
    /** D28, design §3.5: whether the requester may upload here, asked before the upload is read. */
    readonly authorizeImport: AuthorizeImport;
    /** D28, design §3.2: the Money Manager import's upload, adjustments, confirm, undo and history. */
    readonly startImport: StartImport;
    readonly adjustImport: AdjustImport;
    readonly confirmImport: ConfirmImport;
    readonly undoImport: UndoImport;
    readonly listImports: ListImports;
    /** Design §3.5: the 7-day snapshot cleanup; no job calls it yet. */
    readonly removeExpiredSnapshots: RemoveExpiredSnapshots;
    /** Design §3.5: how long the upload route waits for a body before giving up (`ImportTimedOut`). */
    readonly uploadReadTimeoutMs: number;
  };
  /** D30: the global daily exchange-rate store, read on demand and written by the in-container fetch job. */
  readonly rates: {
    readonly repository: ExchangeRateRepository;
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
const ONE_MINUTE = 60 * 1000;

export interface ContainerOptions {
  /** Test seam: replaces the post-sign-up provisioning step. */
  readonly provisionUser?: (user: AuthUser) => Promise<Result<void>>;
  readonly authLimits?: AuthLimits;
  /** Test seam: delivers invitation emails instead of SMTP (ADR 0007), which is off without SMTP_URL. */
  readonly emailSender?: EmailSender;
  /** Test seam: stands for a configured SMTP server (ADR 0007), which also turns email verification on (P282). */
  readonly mailer?: Mailer;
  /** Test seam: replaces the system clock, so a test decides what "today" is (a plan closes only after its period). */
  readonly clock?: Clock;
  /** Test seam: the installation's defaults and locks (HU-E1-15); the built-in es-CO rules until HU-E8-18. */
  readonly installationRules?: InstallationRulesReader;
  /** P339: @usuario lookups and friend requests per person per minute; 30 by default. */
  readonly handleLookupsPerMinute?: number;
  /** Exports per person per minute (design §3.6); 5 by default. */
  readonly exportsPerMinute?: number;
  /** Test seam: how long an upload's reads may take (design §3.5); 30 seconds by default. */
  readonly importTimeoutMs?: number;
  /** Test seam: how long an upload's body may take to arrive (design §3.5); a minute by default. */
  readonly uploadReadTimeoutMs?: number;
}

/**
 * The ledger's categories, read from the categories module; the ledger never imports it. Only writers look one up, to
 * name it in a movement or a recurrence, so the lookup takes the tree lock's shared side first (#245): a delete in
 * progress is waited for and answers CategoryNotFound, and one that starts later sees the reference (CategoryInUse).
 * Money writes hold the space row before this, and a tree writer takes no space lock, so the two never cross.
 */
export const ledgerCategoriesOf = (categories: CategoryRepository): LedgerDeps["categories"] => ({
  find: async (spaceId, categoryId) => {
    await categories.lockTreeForReference(spaceId);
    const category = (await categories.listCategories(spaceId)).find((c) => c.id === categoryId);
    return category ? { id: category.id, archived: category.archivedAt !== null } : null;
  },
  // HU-E3-04: the filter's subcategories; listCategories skips deleted rows and keeps archived ones.
  subcategoriesOf: async (spaceId, categoryIds) =>
    (await categories.listCategories(spaceId))
      .filter((c) => c.parentCategoryId !== null && categoryIds.includes(c.parentCategoryId))
      .map((c) => c.id),
});

/** HU-E6-04: plans map the space's live categories; deleted ones never appear (D8). */
export const budgetCategoriesOf = (categories: CategoryRepository): BudgetCategories => ({
  // Issue #245: the tree lock's shared side, as the ledger's lookup takes it; a delete holds the exclusive one.
  lockForReference: (spaceId) => categories.lockTreeForReference(spaceId),
  list: async (spaceId) =>
    (await categories.listCategories(spaceId)).map((c) => ({
      id: c.id,
      archived: c.archivedAt !== null,
      parentCategoryId: c.parentCategoryId,
    })),
});

/**
 * Ruling P297: each category's live movements in the space, in one grouped read of the ledger's table, never stored
 * (D7). A deleted movement (D8) no longer counts; a subcategory's movements are its own, under its own id.
 */
export const categoryUsageCountsOf = (tm: DrizzleTransactionManager): CategoryUsageCounts => ({
  usageCountsOf: async (spaceId) => {
    const rows = await tm
      .executor()
      .select({ categoryId: transactionsTable.categoryId, count: sql<number>`count(*)::integer` })
      .from(transactionsTable)
      .where(
        and(
          eq(transactionsTable.spaceId, spaceId),
          isNull(transactionsTable.deletedAt),
          isNotNull(transactionsTable.categoryId),
        ),
      )
      .groupBy(transactionsTable.categoryId);
    return new Map(rows.map((row) => [row.categoryId!, row.count]));
  },
});

/**
 * P337: the categories of the space a plan or a recurrence names, in one read each: a budget line's mapping (any plan,
 * on a line not deleted) and a recurrence's template, ended or paused ones included. The import's "Archivar las de
 * Hearth que no uses" never archives one of them.
 */
export const categoryReferencesOf =
  (tm: DrizzleTransactionManager) =>
  async (spaceId: string): Promise<ReadonlySet<string>> => {
    const db = tm.executor();
    const mapped = await db
      .selectDistinct({ categoryId: budgetLineCategoriesTable.categoryId })
      .from(budgetLineCategoriesTable)
      .innerJoin(budgetPlansTable, eq(budgetPlansTable.id, budgetLineCategoriesTable.planId))
      .innerJoin(budgetLinesTable, eq(budgetLinesTable.id, budgetLineCategoriesTable.lineId))
      .where(and(eq(budgetPlansTable.spaceId, spaceId), isNull(budgetLinesTable.deletedAt)));
    const repeated = await db
      .selectDistinct({ categoryId: recurrencesTable.categoryId })
      .from(recurrencesTable)
      .where(and(eq(recurrencesTable.spaceId, spaceId), isNotNull(recurrencesTable.categoryId)));
    return new Set([...mapped, ...repeated].map((row) => row.categoryId!));
  };

/** HU-E3-03: soft-deleted transactions and every budget-line mapping, ended ones included, are references (D8). */
export const categoryUsageOf = (
  ledger: Pick<DrizzleLedgerQueries, "isCategoryReferenced">,
  plans: Pick<DrizzleBudgetPlanRepository, "isCategoryMapped">,
): CategoryUsage => ({
  isCategoryReferenced: async (categoryId) =>
    (await ledger.isCategoryReferenced(categoryId)) || (await plans.isCategoryMapped(categoryId)),
});

/**
 * D6, HU-E1-03: what fixes a space's currency. A plan's capacities and lines are amounts in the space currency too
 * (HU-E6-01). Issue 169: an account records money only when it holds an amount, so sign-up's starter accounts at zero
 * never lock the currency; an account's currency is its space's (no column of its own), so they follow a change with
 * nothing to move. A recurrence stores its amount with its own currency and records its occurrences in it; an ended
 * one counts too, since it keeps that amount and can be extended again (#115).
 */
export const spaceUsageOf = (sources: {
  readonly accounts: Pick<AccountRepository, "listBySpace">;
  readonly recurrences: Pick<DrizzleRecurrenceRepository, "list">;
  readonly ledger: Pick<DrizzleLedgerQueries, "hasTransactions">;
  readonly plans: Pick<DrizzleBudgetPlanRepository, "hasPlans">;
}): SpaceUsage => ({
  hasMoneyRecords: async (spaceId) =>
    (await sources.accounts.listBySpace(spaceId)).some(holdsMoney) ||
    (await sources.recurrences.list(spaceId)).length > 0 ||
    (await sources.ledger.hasTransactions(spaceId)) ||
    (await sources.plans.hasPlans(spaceId)),
});

export const buildContainer = (env: Env, options: ContainerOptions = {}): Container => {
  const { db, pool } = createDatabase(env.DATABASE_URL);
  const tm = new DrizzleTransactionManager(db);
  const ids = new UuidV7IdGenerator();
  const clock = options.clock ?? clockFrom(env.HEARTH_E2E_FIXED_NOW);
  const logger = leveledLogger(env.LOG_LEVEL);
  // Issue #85, ADR 0007: email goes out only when SMTP_URL is set; without it the inviter shares the link (HU-E1-06).
  // Ruling P282: the same condition turns email verification on (#86).
  const mailer =
    options.mailer ??
    (env.SMTP_URL !== undefined && env.SMTP_FROM !== undefined
      ? createSmtpMailer({ url: env.SMTP_URL, from: env.SMTP_FROM, log: logger })
      : null);
  const provider = new BetterAuthProvider(
    createAuth({
      db,
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      defaultTimeZone: env.APP_TIMEZONE,
      mailer,
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
  // D29, D30: the global daily rate store, written by the in-container fetch job. The ledger reads it when a movement in
  // another currency is recorded (MC3), and the accounts and reporting modules convert on read with its dated read
  // (MC4), each through its own narrow port.
  const exchangeRates = new DrizzleExchangeRates(tm);
  // HU-E2-04: balance = opening balance + ledger movements, computed on read (D7).
  const accountsDeps: AccountsDeps = {
    accounts: new DrizzleAccountRepository(tm),
    access,
    // Issue #245: creating and editing an account write an amount in the space currency, as money writes do (#89).
    spaceLocks: spaceRepository,
    movements: ledgerQueries,
    ids,
    clock,
    // HU-E1-14, HU-E2-06: the requester's today for next billing dates; accounts never import identity.
    userTimeZones: profiles,
    // D29, slice MC4: the space totals convert an account in another currency at the rate of the day asked for.
    rates: exchangeRates,
    tm,
  };
  // HU-E6-01, D10: plans store their period boundaries; periods without a plan follow the space policy.
  const budgetPlans = new DrizzleBudgetPlanRepository(tm);
  const storedPeriods: StoredPeriodSource = (spaceId) => budgetPlans.storedPeriods(spaceId);
  const getAccount = createGetAccount(accountsDeps);
  const listAccounts = createListAccounts(accountsDeps);
  const budgetCategories = budgetCategoriesOf(categoryRepository);
  const transactionRepository = new DrizzleTransactionRepository(tm);
  const ledgerDeps: LedgerDeps = {
    access,
    // Issue #89: money writes hold the space row FOR SHARE; leaving, removing and archiving hold it FOR NO KEY UPDATE.
    spaceLocks: spaceRepository,
    transactions: transactionRepository,
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
              currency: account.currency,
            }
          : null;
      },
    },
    categories: ledgerCategoriesOf(categoryRepository),
    // D29, D30, slice MC3: a foreign-currency movement converts at the date's rate (#89: a read within the space lock).
    rates: exchangeRates,
    // HU-E4-06, HU-E6-07: a CLOSED plan's period takes no change; budgeting answers, the ledger never imports it.
    closedPeriods: createClosedPeriodGuard(budgetPlans),
    // HU-E6-08, spec 5.3: an expense recorded without a split follows its line's allocation in the ACTIVE plan;
    // the ledger asks budgeting through its own port, so neither module imports the other. Ruling P293: the ledger's
    // query already holds the VIEWERs apart (`viewerIds`), so no weight ever names one.
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
  // Ruling P336: an account's new currency reaches its movements through the ledger, which owns them (ADR 0001).
  const currencyChangeDeps: ChangeAccountCurrencyDeps = {
    ...accountsDeps,
    lifecycleLocks: spaceRepository,
    conversion: {
      convert: createConvertAccountMovements({
        movements: transactionRepository,
        transactions: transactionRepository,
        audit: ledgerDeps.audit,
        closedPeriods: ledgerDeps.closedPeriods,
        spaceLocks: spaceRepository,
        ids,
        clock,
      }),
    },
  };
  const recordIncome = createRecordIncome(ledgerDeps);
  const recordTransfer = createRecordTransfer(ledgerDeps);
  const recordAdjustment = createRecordAdjustment(ledgerDeps);
  const recordFundContribution = createRecordFundContribution(ledgerDeps);
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
      members: spaceRepository,
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
  // HU-E1-13, P331: one person's split and several people's parts share how a direct space is found and recorded in.
  const directSplitDeps: SplitWithPersonDeps<DirectSplitExpense, RecordedExpense> = {
    access,
    spaces: spaceRepository,
    direct: spaceRepository,
    onCreated: onSpaceCreated,
    recordExpense: ({ spaceId, userId, expense }) =>
      recordExpenseByCategoryKey({ spaceId, userId, ...expense }),
    ids,
    clock,
    tm,
  };
  // P334: a transfer to or from someone, as a settlement in their direct space, found or created as a split is.
  const recordPairSettlement = createRecordPairSettlement(
    { access, spaceLocks: spaceRepository, members: spaceRepository },
    createRecordSettlement(ledgerDeps),
  );
  const directSettlementDeps: SplitWithPersonDeps<DirectSettlementTransfer, Transaction> = {
    ...directSplitDeps,
    recordExpense: ({ spaceId, userId, expense }) => recordPairSettlement({ spaceId, userId, ...expense }),
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
  /**
   * HU-E6-03: SAVINGS lines name their callers' own savings accounts, which live in their personal spaces (D9). One
   * query reads the accounts with the space each lives in. A shared fund has no owner, so no line names it; an owned
   * account follows its home space's currency while its owner is a current member there (the owner's personal space,
   * HU-E2-01, where the owner always is).
   */
  const savingsAccountsByIds = async (
    executor: Executor,
    accountIds: readonly string[],
  ): Promise<Map<string, BudgetAccount>> => {
    const rows = await executor
      .select({
        id: accountsTable.id,
        ownerUserId: accountsTable.ownerUserId,
        type: accountsTable.type,
        archivedAt: accountsTable.archivedAt,
        currency: spacesTable.currency,
      })
      .from(accountsTable)
      .innerJoin(spacesTable, eq(spacesTable.id, accountsTable.spaceId))
      .innerJoin(
        spaceMembersTable,
        and(
          eq(spaceMembersTable.spaceId, accountsTable.spaceId),
          eq(spaceMembersTable.userId, accountsTable.ownerUserId),
          isNull(spaceMembersTable.leftAt),
        ),
      )
      .where(inArray(accountsTable.id, [...accountIds]));
    return new Map(
      rows.flatMap((row) =>
        row.ownerUserId === null
          ? []
          : [
              [
                row.id,
                {
                  id: row.id,
                  ownerUserId: row.ownerUserId,
                  isSavings: row.type === "SAVINGS",
                  archived: row.archivedAt !== null,
                  currency: row.currency,
                },
              ] as const,
            ],
      ),
    );
  };
  /**
   * #84 M3A-1: the lookups one transaction starts together (a plan view asks for every account its SAVINGS lines name
   * at once) wait for the current microtask to end and are answered by one query. Batches are kept per executor, so a
   * query always runs in the transaction of the lookups it answers.
   */
  const savingsBatches = new Map<
    Executor,
    { ids: Set<string>; found: Promise<Map<string, BudgetAccount>> }
  >();
  const savingsAccounts: SavingsAccountReader = {
    find: async (accountId) => {
      // Ids come from request bodies; the port answers null for anything that is not a UUID.
      if (!isUuid(accountId)) return null;
      const executor = tm.executor();
      let batch = savingsBatches.get(executor);
      if (batch === undefined) {
        const ids = new Set<string>();
        const found = Promise.resolve().then(() => {
          savingsBatches.delete(executor);
          return savingsAccountsByIds(executor, [...ids]);
        });
        batch = { ids, found };
        savingsBatches.set(executor, batch);
      }
      batch.ids.add(accountId);
      return (await batch.found).get(accountId) ?? null;
    },
  };
  /**
   * A copied plan's view walks its carry-over chain back through every earlier plan: its history is read in one batch
   * of seven statements (the plans, their contents, the expenses and the savings transfers within each plan's dates),
   * whatever the chain's length, within the request and never stored (D7).
   */
  const planHistory: PlanHistoryReader = {
    historyOf: async (spaceId) => {
      const plans = await budgetPlans.inSpace(spaceId);
      const contents = await budgetPlans.contentsOf(plans.map((plan) => plan.id));
      const ranges = plans.map((plan) => plan.period);
      const expenses = await ledgerQueries.expensesByCategoryIn(spaceId, ranges);
      const named = [...contents.values()].flatMap((parts) =>
        parts.lines.flatMap((line) => line.savingsAccountIds),
      );
      const transfers = await ledgerQueries.transfersIntoAccountsIn([...new Set(named)], ranges);
      return {
        plans,
        contents,
        expenses: new Map(plans.map((plan, i) => [plan.id, expenses[i] ?? []])),
        transfers: new Map(plans.map((plan, i) => [plan.id, transfers[i] ?? []])),
      };
    },
  };
  // HU-E6-01 … HU-E6-05: plans reach members, accounts, categories and the ledger's spending only through ports.
  const budgetingDeps = {
    access,
    // Issue #245: creating or copying a plan holds the space row as a money write does; a settings change waits for it.
    spaceLocks: spaceRepository,
    members: spaceRepository,
    plans: budgetPlans,
    allocations: budgetPlans,
    statuses: budgetPlans,
    mappings: budgetPlans,
    categories: budgetCategories,
    lines: budgetPlans,
    savingsAccounts,
    history: planHistory,
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
    history: planHistory,
    // Ruling P327: an account's screen counts what it paid, received and moved, from the ledger's list (P277).
    accountMovements: accountMovementsOf(accountsDeps.accounts, ledgerQueries),
    // D29, slice MC4: the unified view converts every space's figures into the caller's display currency (identity) at
    // each day's rate (rates); reporting imports neither module.
    rates: exchangeRates,
    displayCurrencyOf: (userId: string) => profiles.displayCurrencyOf(userId),
  };
  const invitationRepository = new DrizzleInvitationRepository(tm);
  const invitationsDeps: InvitationsDeps = {
    access,
    members: spaceRepository,
    spaces: spaceRepository,
    invitations: invitationRepository,
    spaceLocks: spaceRepository,
    tokens: cryptoInvitationTokens,
    // The response always carries the URL; emailSent is false when nothing went out (no SMTP_URL, or a failed send).
    emailSender: options.emailSender ?? (mailer ? mailedInvitations(mailer) : { send: async () => false }),
    // Issue #86, ruling P282: email invitations admit only confirmed addresses, once SMTP can send the confirmation.
    ...(mailer
      ? {
          verifiedEmails: {
            isVerified: (userId: string) => provider.isEmailVerified(userId),
            requestVerification: (email: string) => provider.requestVerification(email),
          },
        }
      : {}),
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
  const referralStore = new DrizzleReferrals(tm);
  const referralsDeps: ReferralsDeps = {
    codes: referralStore,
    referrals: referralStore,
    // D27: the identity module's accounts (name, confirmed email, creation), which referrals never import.
    people: profiles,
    random: cryptoReferralRandom,
    clock,
    // The SPA's link page (`/r/<code>`); the URL carries only the code.
    referralUrl: (code) => new URL(`/r/${code}`, env.BETTER_AUTH_URL).toString(),
  };
  // P339 (S3): finding someone by their @ is throttled per person, as sign-in is per address, so handles cannot be
  // guessed in bulk; a friend request names a handle too, so it counts against the same window.
  const lookupsByUser = createFixedWindowLimiter({
    limit: options.handleLookupsPerMinute ?? 30,
    windowMs: ONE_MINUTE,
  });
  const handleLookupThrottle = { allows: (userId: string) => lookupsByUser.hit(userId) };
  // P338: Amigos; P339 answers a friend just added with its row.
  const listMyFriends = createListMyFriends({
    access,
    members: spaceRepository,
    spaces: spaceRepository,
    aliases: spaceRepository,
    source: ledgerQueries,
    movements: ledgerQueries,
    // P339: a registered friend's @usuario, from identity's profiles (balances never imports identity).
    handles: {
      handlesOf: async (userIds) =>
        new Map(
          (await profiles.holdersOf(userIds)).flatMap((holder) =>
            holder.handle ? [[holder.userId, holder.handle] as const] : [],
          ),
        ),
    },
  });
  // P339 (S9): Movimientos and Inicio say whether a payment paid or lent from the pair's balance just before it,
  // replayed on read by balances over the ledger's debt movements; the ledger never imports balances.
  const settlementContexts = { contextOf: createGetSettlementContexts(ledgerQueries) };
  // HU-E1-09: every current member's net from one aggregate (balances' GetMemberNetBalances).
  const archiveSpace = createArchiveSpace({
    ...lifecycleDeps,
    spaces: spaceRepository,
    netBalances: createGetMemberNetBalances(ledgerQueries),
  });
  // P339: friend requests live with the direct spaces they open (spaces); the people they name are identity's, read
  // through this port, so spaces never imports identity.
  const friendRequestsDeps: FriendRequestsDeps = {
    ...directSplitDeps,
    requests: new DrizzleFriendRequests(tm),
    people: {
      byHandle: async (raw) => {
        const handle = parseHandle(raw);
        return handle.ok ? profiles.findByHandle(handle.value) : null;
      },
      holdersOf: (userIds) => profiles.holdersOf(userIds),
    },
    throttle: handleLookupThrottle,
  };
  // D28, design §3.6: the export reads through each module's own use cases, which authorize every read again.
  const exportsByUser = createFixedWindowLimiter({
    limit: options.exportsPerMinute ?? 5,
    windowMs: ONE_MINUTE,
  });
  const exportPersonData = createExportPersonData({
    reader: createExportReader({
      listMySpaces: createListMySpaces(spaceRepository),
      listMembers: createListMembers(membersDeps),
      listAccounts,
      listCategories: createListCategories({ ...categoriesDeps, counts: categoryUsageCountsOf(tm) }),
      listRecurrences: createListRecurrences(recurrenceDeps),
      getPlan: createGetBudgetPlan(budgetingDeps),
      transactions: ledgerQueries,
      // Ruling P306's read of every member row, former ones included, as the activity feed binds it.
      memberNamesIn: (spaceIds) => spaceRepository.namesIn(spaceIds),
      // Each stored plan period has exactly one plan (D10).
      planIdsOf: async (spaceId) => {
        const plans = await Promise.all(
          (await budgetPlans.storedPeriods(spaceId)).map((period) =>
            budgetPlans.covering(spaceId, period.start),
          ),
        );
        return plans.flatMap((plan) => (plan === null ? [] : [plan.id]));
      },
    }),
    archive: zipStored,
    throttle: { allows: (userId) => exportsByUser.hit(userId) },
    clock,
    userTimeZones: profiles,
  });
  // D28, design §3.1: the import writes only through the accounts, categories and ledger use cases.
  const importDeps = {
    access,
    spaceLocks: spaceRepository,
    reader: createWorkerSnapshotReader(options.importTimeoutMs),
    batches: new DrizzleImportBatches(tm),
    links: new DrizzleImportLinks(tm),
    writer: createUseCaseImportWriter({
      accounts: accountsDeps.accounts,
      categories: categoryRepository,
      ledgerQueries,
      usageCounts: categoryUsageCountsOf(tm),
      categoryReferences: categoryReferencesOf(tm),
      createAccount: createCreateAccount(accountsDeps),
      archiveAccount: createArchiveAccount(accountsDeps),
      restoreAccount: createRestoreAccount(accountsDeps),
      createCategoryGroup: createCreateCategoryGroup(categoriesDeps),
      archiveCategoryGroup: createArchiveCategoryGroup(categoriesDeps),
      restoreCategoryGroup: createRestoreCategoryGroup(categoriesDeps),
      createCategory: createCreateCategory(categoriesDeps),
      archiveCategory: createArchiveCategory(categoriesDeps),
      restoreCategory: createRestoreCategory(categoriesDeps),
      recordExpense,
      recordIncome,
      recordTransfer,
      recordAdjustment,
      deleteTransaction: createDeleteTransaction(ledgerDeps),
      // P337: a Persona is a guest in the pair's direct space (P338), its movements P334's settlements there.
      startDirectSpaceWithGuest: createStartDirectSpaceWithGuest(directSplitDeps),
      recordPairSettlement,
    }),
    digest: (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex"),
    ids,
    clock,
    userTimeZones: profiles,
    tm,
  };
  const limits = options.authLimits ?? DEFAULT_AUTH_LIMITS;
  const signInByEmail = createFixedWindowLimiter({ limit: limits.signInPerEmail, windowMs: FIFTEEN_MINUTES });
  const signInByIp = createFixedWindowLimiter({ limit: limits.signInPerIp, windowMs: FIFTEEN_MINUTES });
  const signUpByIp = createFixedWindowLimiter({ limit: limits.signUpPerIp, windowMs: ONE_HOUR });
  return {
    db,
    pool,
    tm,
    logger,
    // HU-E8-02, #190: the health check's database probe, apart from the application's pool; a failure, or no answer
    // within HEALTH_PROBE_TIMEOUT_MS, reads as unreachable.
    databaseReachable: createDatabaseProbe(env.DATABASE_URL).reachable,
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
      verifyEmail: createVerifyEmail(provider),
      updateProfile: createUpdateProfile({ profiles, handles: profiles, rules: installationRules }),
      // HU-E9-13, ruling P124: the installation's zone and, until HU-E8-18 stores one, its built-in language.
      getProfile: createGetProfile({
        profiles,
        handles: profiles,
        rules: installationRules,
        regionDefaults: { timezone: env.APP_TIMEZONE, locale: INSTALLATION_DEFAULT_LOCALE },
      }),
      signIn: createSignIn(provider),
      signOut: createSignOut(provider),
      findUserByHandle: createFindUserByHandle({ handles: profiles, throttle: handleLookupThrottle }),
    },
    spaces: {
      createPersonalSpace,
      listMySpaces: createListMySpaces(spaceRepository),
      getSpace: createGetSpace(access),
      updateSettings: createUpdateSpaceSettings({
        spaces: spaceRepository,
        // Issue #245: a settings change holds the space row as a leave does; money writes and plan creations share it.
        spaceLocks: spaceRepository,
        access,
        tm,
        usage: spaceUsageOf({
          accounts: accountsDeps.accounts,
          recurrences: recurrenceRepository,
          ledger: ledgerQueries,
          plans: budgetPlans,
        }),
        // D29, slice MC3 (HU-E1-03): a money-free space's accounts follow its currency change.
        accountCurrency: accountsDeps.accounts,
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
      restoreInvitation: createRestoreInvitation(invitationsDeps),
      listInvitations: createListInvitations(invitationsDeps),
      acceptInvitation: createAcceptInvitation(invitationsDeps),
      previewInvitation: createPreviewInvitation(invitationsDeps),
      previewClaim: createPreviewClaim(invitationsDeps),
      addGuest: createAddGuestMember(membersDeps),
      addGuests: createAddGuestMembers(membersDeps),
      changeMemberRole: createChangeMemberRole(membersDeps),
      archiveSpace,
      splitWithPerson: createSplitWithPerson<DirectSplitExpense, RecordedExpense>(directSplitDeps),
      splitWithPeople: createSplitWithPeople<DirectSplitExpense, RecordedExpense>(directSplitDeps),
      settleWithPerson: createSplitWithPerson<DirectSettlementTransfer, Transaction>(directSettlementDeps),
      removeGuest: createRemoveGuestMember({ ...lifecycleDeps, invitations: invitationRepository }),
      createGuestClaim: createCreateGuestClaim(claimsDeps),
      claimGuestPlace: createClaimGuestPlace(claimsDeps),
      leaveSpace: createLeaveSpace(lifecycleDeps),
      setFriendNickname: createSetFriendNickname({
        access,
        spaceLocks: spaceRepository,
        members: spaceRepository,
        tm,
      }),
      sendFriendRequest: createSendFriendRequest(friendRequestsDeps),
      listFriendRequests: createListFriendRequests(friendRequestsDeps),
      acceptFriendRequest: createAcceptFriendRequest(friendRequestsDeps),
      rejectFriendRequest: createRejectFriendRequest(friendRequestsDeps),
      addGuestFriend: createStartDirectSpaceWithGuest(directSplitDeps),
      removeFriend: createRemoveFriend({ access, archiveSpace, tm }),
    },
    categories: {
      listCategories: createListCategories({ ...categoriesDeps, counts: categoryUsageCountsOf(tm) }),
      createCategoryGroup: createCreateCategoryGroup(categoriesDeps),
      renameCategoryGroup: createRenameCategoryGroup(categoriesDeps),
      moveCategoryGroup: createMoveCategoryGroup(categoriesDeps),
      createCategory: createCreateCategory(categoriesDeps),
      updateCategory: createUpdateCategory(categoriesDeps),
      deleteCategory: createDeleteCategory({
        ...categoriesDeps,
        usage: categoryUsageOf(ledgerQueries, budgetPlans),
      }),
      archiveCategory: createArchiveCategory(categoriesDeps),
      restoreCategory: createRestoreCategory(categoriesDeps),
      archiveCategoryGroup: createArchiveCategoryGroup(categoriesDeps),
      restoreCategoryGroup: createRestoreCategoryGroup(categoriesDeps),
    },
    accounts: {
      createAccount: createCreateAccount(accountsDeps),
      updateAccount: createUpdateAccount(accountsDeps),
      previewAccountCurrency: createPreviewAccountCurrency(currencyChangeDeps),
      changeAccountCurrency: createChangeAccountCurrency(currencyChangeDeps),
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
      recordAdjustment,
      recordFundContribution,
      recordSettlement: createRecordSettlement(ledgerDeps),
      listTransactions: createListTransactions(ledgerDeps),
      listMyActivity: createListMyActivity({
        spaces: spaceRepository,
        places: spaceRepository,
        members: spaceRepository,
        recent: ledgerQueries,
        categories: categoryRepository,
        settlements: settlementContexts,
      }),
      getAccountUsage: createGetAccountUsage({
        usage: ledgerQueries,
        clock,
        userTimeZones: ledgerDeps.userTimeZones,
      }),
      listMyTransactions: createListMyTransactions({
        spaces: spaceRepository,
        places: spaceRepository,
        members: spaceRepository,
        categories: categoryRepository,
        categoryTree: ledgerDeps.categories,
        access,
        storedPeriods,
        clock,
        userTimeZones: ledgerDeps.userTimeZones,
        query: ledgerQueries,
        settlements: settlementContexts,
      }),
      getTransaction: createGetTransaction(ledgerDeps),
      editTransaction: createEditTransaction(ledgerDeps),
      deleteTransaction: createDeleteTransaction(ledgerDeps),
      restoreTransaction: createRestoreTransaction(ledgerDeps),
      // Issue #195: the new movement is recorded through the ledger's own use cases, in the conversion's transaction.
      convertTransaction: createConvertTransaction(ledgerDeps, {
        recordExpense,
        recordIncome,
        recordTransfer,
        recordFundContribution,
      }),
      undoConversion: createUndoConversion(ledgerDeps),
      listAudit: createListAudit(ledgerDeps),
      defineRecurrence: createDefineRecurrence(recurrenceDeps),
      listRecurrences: createListRecurrences(recurrenceDeps),
      getRecurrence: createGetRecurrence(recurrenceDeps),
      listUpcomingOccurrences: createListUpcomingOccurrences(recurrenceDeps),
      previewSchedule: createPreviewSchedule(recurrenceDeps),
      updateRecurrence: createUpdateRecurrence(recurrenceDeps),
      pauseRecurrence: createPauseRecurrence(recurrenceDeps),
      resumeRecurrence: createResumeRecurrence(recurrenceDeps),
      endRecurrence: createEndRecurrence(recurrenceDeps),
      extendRecurrence: createExtendRecurrence(recurrenceDeps),
      materializeDueOccurrences: createMaterializeDueOccurrences(materializeDeps),
      listPendingOccurrences: createListPendingOccurrences(recurrenceDeps),
      listMyPendingOccurrences: createListMyPendingOccurrences({
        ...recurrenceDeps,
        spaces: spaceRepository,
      }),
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
      // #240 (P278): the viewer's standing in each of her spaces, from the same balances (D7).
      getMyBalances: createGetMyBalances({
        access,
        members: spaceRepository,
        spaces: spaceRepository,
        source: ledgerQueries,
      }),
      // P338: Amigos reads the same balances (D7), the viewer's apodos and each direct space's newest movement.
      listMyFriends,
      getMyFriend: createGetMyFriend(listMyFriends),
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
      // #240: the fund accounts every member reads in the space's accounts name the fund it tracks.
      getFundContributions: createGetFundContributions({
        ...reportingDeps,
        funds: {
          fundsOf: async (spaceId) =>
            (await accountsDeps.accounts.listBySpace(spaceId))
              .filter((account) => account.type === "SHARED_FUND" && account.archivedAt === null)
              .map((account) => ({ id: account.id, name: account.name })),
        },
      }),
      getUnifiedPersonalView: createGetUnifiedPersonalView(reportingDeps),
      getLineTrend: createGetLineTrend(reportingDeps),
      getPersonalTrend: createGetPersonalTrend(reportingDeps),
      getSpendingByGroup: createGetSpendingByGroup(reportingDeps),
      getPersonalSpendingByGroup: createGetPersonalSpendingByGroup(reportingDeps),
      // #150, rulings P238–P240: the caller's own money across every space they belong to, on read (D7).
      getCashFlow: createGetCashFlow({
        clock,
        userTimeZones: profiles,
        // D29, slice MC4: the projection is in the caller's display currency, converting at each movement's day.
        rates: exchangeRates,
        displayCurrencyOf: (userId) => profiles.displayCurrencyOf(userId),
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
    referrals: {
      getMine: createGetMyReferrals(referralsDeps),
      preview: createPreviewReferral(referralsDeps),
      claim: createClaimReferrer(referralsDeps),
    },
    portability: {
      exportPersonData,
      authorizeImport: createAuthorizeImport(importDeps),
      startImport: createStartImport(importDeps),
      adjustImport: createAdjustImport(importDeps),
      confirmImport: createConfirmImport(importDeps),
      undoImport: createUndoImport(importDeps),
      listImports: createListImports(importDeps),
      removeExpiredSnapshots: createRemoveExpiredSnapshots(importDeps),
      uploadReadTimeoutMs: options.uploadReadTimeoutMs ?? 60_000,
    },
    rates: {
      repository: exchangeRates,
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
