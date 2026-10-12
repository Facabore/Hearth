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
import { FixedClock, type LocalDate } from "@/shared/kernel";
import { fakeSpaceAccess, memoryTm, membership, noStoredPeriods, sequentialIds } from "./fakes";

export const ACCOUNTS = {
  bancolombia: { id: "acc-bancolombia", spaceId: "space-ana", ownerUserId: "u-ana", archived: false },
  nequi: { id: "acc-nequi", spaceId: "space-ana", ownerUserId: "u-ana", archived: false },
  oldNequi: { id: "acc-old-nequi", spaceId: "space-ana", ownerUserId: "u-ana", archived: true },
  davivienda: { id: "acc-davivienda", spaceId: "space-juan", ownerUserId: "u-juan", archived: false },
} satisfies Record<string, LedgerAccount>;

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
    storedPeriods: noStoredPeriods,
    ids: sequentialIds("tx"),
    clock: new FixedClock(new Date("2026-10-28T15:00:00Z")),
    timeZone: "America/Bogota",
    tm: memoryTm,
    ...overrides,
  };
  return { deps, store, audit };
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
  ...overrides,
});
