import type {
  AccountReader,
  AuditEntry,
  AuditLog,
  CategoryReader,
  Expense,
  Income,
  LedgerAccount,
  LedgerDeps,
  Transaction,
  TransactionFilter,
  TransactionId,
  TransactionPosition,
  TransactionQuery,
  TransactionRepository,
  Transfer,
} from "@/modules/ledger/application";
import { createSpaceAccess, type SpaceMember } from "@/modules/spaces/application";
import { FixedClock, type LocalDate } from "@/shared/kernel";
import { fakeSpaceAccess, memoryTm, membership, noStoredPeriods, sequentialIds } from "./fakes";
import { HOUSEHOLD_MEMBERS, householdSpace, InMemorySpaceStore, memberOf } from "./in-memory-spaces";

const personalAccount = (id: string, spaceId: string, ownerUserId: string, archived = false) => ({
  id,
  spaceId,
  ownerUserId,
  isSharedFund: false,
  archived,
});
const sharedFund = (id: string, spaceId: string, archived = false) => ({
  id,
  spaceId,
  ownerUserId: null,
  isSharedFund: true,
  archived,
});

export const ACCOUNTS = {
  bancolombia: personalAccount("acc-bancolombia", "space-ana", "u-ana"),
  nequi: personalAccount("acc-nequi", "space-ana", "u-ana"),
  oldNequi: personalAccount("acc-old-nequi", "space-ana", "u-ana", true),
  davivienda: personalAccount("acc-davivienda", "space-juan", "u-juan"),
  // HU-E4-09/10: shared funds are recognised by their type; their missing owner is incidental.
  householdFund: sharedFund("acc-household-fund", "space-household"),
  oldFund: sharedFund("acc-old-fund", "space-household", true),
  tripFund: sharedFund("acc-trip-fund", "space-trip"),
  // Test double only (accounts_shared_fund_owner forbids it in PostgreSQL): proves funds are found by type.
  ownerlessCash: {
    id: "acc-ownerless-cash",
    spaceId: "space-household",
    ownerUserId: null,
    isSharedFund: false,
    archived: false,
  },
} satisfies Record<string, LedgerAccount>;

/** HU-E4-10 Background: Household Fund opens with 1,500,000 COP; every other account opens at 0. */
const OPENING_BALANCES: Readonly<Record<string, bigint>> = { [ACCOUNTS.householdFund.id]: 150_000_000n };

interface CategoryRow {
  readonly id: string;
  readonly spaceId: string;
  readonly archived: boolean;
}

export const CATEGORIES = {
  groceries: { id: "cat-groceries", spaceId: "space-ana", archived: false },
  restaurants: { id: "cat-restaurants", spaceId: "space-ana", archived: false },
  salary: { id: "cat-salary", spaceId: "space-ana", archived: false },
  archived: { id: "cat-archived", spaceId: "space-ana", archived: true },
  juanFood: { id: "cat-juan-food", spaceId: "space-juan", archived: false },
  household: { id: "cat-household", spaceId: "space-household", archived: false },
} satisfies Record<string, CategoryRow>;

const accountReader = (accounts: readonly LedgerAccount[]): AccountReader => ({
  find: async (id) => accounts.find((a) => a.id === id) ?? null,
});

const categoryReader = (rows: readonly CategoryRow[]): CategoryReader => ({
  find: async (spaceId, id) => {
    const row = rows.find((r) => r.spaceId === spaceId && r.id === id);
    return row ? { id: row.id, archived: row.archived } : null;
  },
});

/** Repository and query side over one array; mirrors the SQL semantics pinned in Tasks 20–21. */
export class InMemoryTransactions implements TransactionRepository, TransactionQuery {
  rows: Transaction[] = [];

  async add(transaction: Transaction) {
    this.rows.push(transaction);
  }

  async findById(spaceId: string, transactionId: string, includeDeleted = false) {
    return (
      this.rows.find(
        (t) => t.id === transactionId && t.spaceId === spaceId && (includeDeleted || t.deletedAt === null),
      ) ?? null
    );
  }

  async save(transaction: Transaction, expectedVersion: number) {
    const index = this.rows.findIndex((t) => t.id === transaction.id);
    if (index < 0 || this.rows[index]!.version !== expectedVersion) return false;
    this.rows[index] = { ...transaction, version: expectedVersion + 1 };
    return true;
  }

  async list(filter: TransactionFilter, after: TransactionPosition | null, limit: number) {
    return this.matching(filter)
      .filter((t) => after === null || t.date < after.date || (t.date === after.date && t.id < after.id))
      .slice(0, limit);
  }

  async totals(filter: TransactionFilter) {
    const rows = this.matching(filter);
    const total = (type: Transaction["type"]) =>
      rows.filter((t) => t.type === type).reduce((sum, t) => sum + t.amount, 0n);
    return { expenses: total("EXPENSE"), income: total("INCOME") };
  }

  /** Net movements of one account over live transactions, like DrizzleLedgerQueries.netMovements. */
  netOf(accountId: string): bigint {
    let net = 0n;
    for (const t of this.rows) {
      if (t.deletedAt !== null) continue;
      if (t.type !== "EXPENSE" && t.destinationAccountId === accountId) net += t.amount;
      if ((t.type === "TRANSFER" || t.type === "SETTLEMENT") && t.sourceAccountId === accountId)
        net -= t.amount;
      if (t.type === "EXPENSE") {
        for (const payment of t.payments) if (payment.accountId === accountId) net -= payment.amount;
      }
    }
    return net;
  }

  private matching(f: TransactionFilter): Transaction[] {
    return this.rows
      .filter((t) => t.spaceId === f.spaceId && t.deletedAt === null && t.date >= f.from && t.date <= f.to)
      .filter((t) => f.type === undefined || t.type === f.type)
      .filter(
        (t) => !f.categoryIds?.length || (t.categoryId !== null && f.categoryIds.includes(t.categoryId)),
      )
      .filter(
        (t) =>
          f.payerMemberId === undefined ||
          (t.type === "EXPENSE" && t.payments.some((p) => p.memberId === f.payerMemberId)),
      )
      .filter(
        (t) =>
          f.participantMemberId === undefined ||
          (t.type === "EXPENSE" && t.shares.some((s) => s.memberId === f.participantMemberId)),
      )
      .sort((a, b) => (a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1));
  }
}

export class InMemoryAudit implements AuditLog {
  readonly entries: AuditEntry[] = [];
  async append(entry: AuditEntry) {
    this.entries.push(entry);
  }
  async listFor(transactionId: string) {
    return this.entries.filter((e) => e.transactionId === transactionId);
  }
}

/** Ana (OWNER) in her personal space: COP, MONTHLY(1), today 2026-10-28 in Bogotá. */
export const ledgerFixture = (overrides: Partial<LedgerDeps> = {}) => {
  const store = new InMemoryTransactions();
  const audit = new InMemoryAudit();
  const deps: LedgerDeps = {
    access: fakeSpaceAccess(membership()),
    transactions: store,
    query: store,
    audit,
    accounts: accountReader(Object.values(ACCOUNTS)),
    categories: categoryReader(Object.values(CATEGORIES)),
    closedPeriods: { isClosed: async () => false },
    // HU-E2-04 as the accounts module computes it: opening balance plus movements.
    accountBalances: {
      balanceOf: async (_spaceId, _userId, accountId) =>
        (OPENING_BALANCES[accountId] ?? 0n) + store.netOf(accountId),
    },
    storedPeriods: noStoredPeriods,
    // Ana alone in her personal space; householdLedger binds a real member list.
    members: {
      listCurrent: async (spaceId) => (spaceId === "space-ana" ? [memberOf("Ana", "OWNER", 0)] : []),
    },
    ids: sequentialIds("tx"),
    clock: new FixedClock(new Date("2026-10-28T15:00:00Z")),
    timeZone: "America/Bogota",
    tm: memoryTm,
    ...overrides,
  };
  return { deps, store, audit };
};

/**
 * "Household" (`space-household`, COP, MONTHLY(1)) as the ledger sees it: memberships and the current
 * member list come from one in-memory spaces store (HU-E1-05 Background members unless given).
 */
export const householdLedger = (
  members: readonly SpaceMember[] = HOUSEHOLD_MEMBERS,
  overrides: Partial<LedgerDeps> = {},
) => {
  const spaces = new InMemorySpaceStore();
  spaces.seed(householdSpace(members));
  return ledgerFixture({ access: createSpaceAccess(spaces), members: spaces, ...overrides });
};

let seeded = 0;

/** Increasing ids, so for equal dates "newest first" means the highest id, like UUIDv7 in production. */
const baseOf = (date: string, amount: bigint) => ({
  id: `seed-${String(++seeded).padStart(5, "0")}` as TransactionId,
  spaceId: "space-ana",
  description: "",
  date: date as LocalDate,
  amount,
  currency: "COP",
  createdBy: "u-ana",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  deletedAt: null,
  version: 1,
});

export const anExpense = (date: string, amount: bigint, overrides: Partial<Expense> = {}): Expense => ({
  ...baseOf(date, amount),
  type: "EXPENSE",
  categoryId: CATEGORIES.groceries.id,
  payments: [{ memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount }],
  shares: [{ memberId: "member-ana", amount, splitMethod: "EQUAL" }],
  ...overrides,
});

export const anIncome = (date: string, amount: bigint, overrides: Partial<Income> = {}): Income => ({
  ...baseOf(date, amount),
  type: "INCOME",
  categoryId: CATEGORIES.salary.id,
  destinationAccountId: ACCOUNTS.bancolombia.id,
  receivingMemberId: "member-ana",
  ...overrides,
});

export const aTransfer = (date: string, amount: bigint, overrides: Partial<Transfer> = {}): Transfer => ({
  ...baseOf(date, amount),
  type: "TRANSFER",
  categoryId: null,
  sourceAccountId: ACCOUNTS.bancolombia.id,
  destinationAccountId: ACCOUNTS.nequi.id,
  payerMemberId: null,
  ...overrides,
});
