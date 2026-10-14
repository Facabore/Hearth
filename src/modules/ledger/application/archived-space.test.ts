import { describe, expect, it } from "vitest";
import { createSpaceAccess } from "@/modules/spaces/application";
import type { LocalDate, Result } from "@/shared/kernel";
import { codeOf, fakeSpaceAccess, membership, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, anExpense, CATEGORIES, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import { householdSpace, InMemorySpaceStore } from "../../../../tests/support/in-memory-spaces";
import { createDeleteTransaction } from "./delete-transaction";
import { createEditTransaction } from "./edit-transaction";
import { createGetTransaction } from "./get-transaction";
import { createListAudit } from "./list-audit";
import { createListTransactions } from "./list-transactions";
import { createRecordExpense } from "./record-expense";
import { createRecordExpenseByCategoryKey } from "./record-expense-by-category-key";
import { createRecordFundContribution } from "./record-fund-contribution";
import { createRecordIncome } from "./record-income";
import { createRecordSettlement } from "./record-settlement";
import { createRecordTransfer } from "./record-transfer";

const date = (iso: string) => iso as LocalDate;
const ana = { spaceId: "space-ana", userId: "u-ana" };
const household = { spaceId: "space-household", userId: "u-ana" };

/**
 * Where the ledger records: Ana's `space-ana`, whose accounts and categories the fixtures hold (the ledger
 * only looks at the membership's archived flag, not at the space kind), or Household with its fund.
 * Either one archived or not, with one expense of Ana's already recorded while it was active.
 */
const world = (where: "ana" | "household", archived: boolean) => {
  const spaces = new InMemorySpaceStore();
  spaces.seed(householdSpace());
  if (archived && where === "household") spaces.archived.add("space-household");
  const fixture = ledgerFixture(
    where === "ana"
      ? { access: fakeSpaceAccess(membership({ archived })) }
      : { access: createSpaceAccess(spaces), members: spaces },
  );
  const market = anExpense("2026-10-05", 8_500_000n, { description: "Market" });
  fixture.store.rows.push(market);
  const { deps } = fixture;
  return {
    ...fixture,
    market,
    recordExpense: createRecordExpense(deps),
    recordByKey: createRecordExpenseByCategoryKey(
      {
        access: deps.access,
        categoryKeys: { findByKey: async () => ({ id: CATEGORIES.groceries.id, archived: false }) },
      },
      createRecordExpense(deps),
    ),
    recordIncome: createRecordIncome(deps),
    recordTransfer: createRecordTransfer(deps),
    contribute: createRecordFundContribution(deps),
    settle: createRecordSettlement(deps),
    edit: createEditTransaction(deps),
    remove: createDeleteTransaction(deps),
    list: createListTransactions(deps),
    get: createGetTransaction(deps),
    history: createListAudit(deps),
  };
};
type World = ReturnType<typeof world>;

const WRITES: readonly (readonly [
  name: string,
  where: "ana" | "household",
  write: (w: World) => Promise<Result<unknown>>,
])[] = [
  [
    "RecordExpense",
    "ana",
    (w) =>
      w.recordExpense({
        ...ana,
        description: "Lunch",
        date: date("2026-10-06"),
        categoryId: CATEGORIES.groceries.id,
        amount: money(2_000_000n),
        accountId: ACCOUNTS.bancolombia.id,
      }),
  ],
  [
    "RecordExpense, shared",
    "household",
    (w) =>
      w.recordExpense({
        ...household,
        description: "Groceries",
        date: date("2026-10-06"),
        categoryId: CATEGORIES.household.id,
        amount: money(30_000_000n),
        payments: [
          { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: money(30_000_000n) },
        ],
        split: { method: "EQUAL", participants: [{ memberId: "member-ana" }, { memberId: "member-juan" }] },
      }),
  ],
  [
    "RecordExpenseByCategoryKey",
    "ana",
    (w) =>
      w.recordByKey({
        ...ana,
        categoryKey: "groceries",
        amount: money(2_000_000n),
        accountId: ACCOUNTS.bancolombia.id,
      }),
  ],
  [
    "RecordIncome",
    "ana",
    (w) =>
      w.recordIncome({
        ...ana,
        description: "Salary",
        date: date("2026-10-25"),
        categoryId: CATEGORIES.salary.id,
        amount: money(320_000_000n),
        accountId: ACCOUNTS.bancolombia.id,
      }),
  ],
  [
    "RecordTransfer",
    "ana",
    (w) =>
      w.recordTransfer({
        ...ana,
        date: date("2026-10-06"),
        amount: money(50_000_000n),
        sourceAccountId: ACCOUNTS.bancolombia.id,
        destinationAccountId: ACCOUNTS.nequi.id,
      }),
  ],
  [
    "RecordFundContribution",
    "household",
    (w) =>
      w.contribute({
        ...household,
        description: "October",
        date: date("2026-10-02"),
        amount: money(48_000_000n),
        fundAccountId: ACCOUNTS.householdFund.id,
        sourceAccountId: ACCOUNTS.bancolombia.id,
      }),
  ],
  [
    "RecordSettlement",
    "household",
    (w) =>
      w.settle({
        spaceId: "space-household",
        userId: "u-juan",
        date: date("2026-10-30"),
        amount: money(120_000_000n),
        payerMemberId: "member-juan",
        receivingMemberId: "member-ana",
      }),
  ],
  [
    "EditTransaction",
    "ana",
    (w) =>
      w.edit({
        ...ana,
        transactionId: w.market.id,
        expectedVersion: null,
        changes: { description: "Groceries" },
      }),
  ],
  ["DeleteTransaction", "ana", (w) => w.remove({ ...ana, transactionId: w.market.id })],
];

describe("archived spaces only read: the ledger (HU-E1-09, Review Focus 4)", () => {
  it.each(WRITES)(
    "%s answers SpaceArchived, where an active space accepts it",
    async (_name, where, write) => {
      expect(codeOf(await write(world(where, false)))).toBe("ok");
      const archived = world(where, true);
      const before = [...archived.store.rows];
      expect(codeOf(await write(archived))).toBe("SpaceArchived");
      expect(archived.store.rows).toEqual(before);
      expect(archived.audit.entries).toEqual([]);
    },
  );

  it("still lists, reads and audits the transactions of an archived space", async () => {
    const w = world("ana", true);
    expect(unwrap(await w.list({ ...ana, after: null, limit: 50 })).items.map((t) => t.id)).toEqual([
      w.market.id,
    ]);
    expect(unwrap(await w.get({ ...ana, transactionId: w.market.id }))).toBe(w.market);
    expect(unwrap(await w.history({ ...ana, transactionId: w.market.id }))).toEqual([]);
  });
});
