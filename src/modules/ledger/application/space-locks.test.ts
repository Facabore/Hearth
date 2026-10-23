import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, fakeSpaceAccess, membership, money } from "../../../../tests/support/fakes";
import { ACCOUNTS, anExpense, CATEGORIES, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import { createDeleteTransaction } from "./delete-transaction";
import { createEditTransaction } from "./edit-transaction";
import { createRecordExpense } from "./record-expense";
import { createRecordFundContribution } from "./record-fund-contribution";
import { createRecordIncome } from "./record-income";
import { createRecordSettlement } from "./record-settlement";
import { createRecordTransfer } from "./record-transfer";

/**
 * Issue #89: every money write takes the space lock before it reads the membership, the archived flag or the current
 * members, so a leave, a removal or an archive in progress is waited for and its result is what the write reads.
 */
const setup = () => {
  const events: string[] = [];
  const base = fakeSpaceAccess(membership());
  const fixture = ledgerFixture({
    access: async (spaceId, userId, options) => {
      events.push(`access ${spaceId}`);
      return base(spaceId, userId, options);
    },
    spaceLocks: {
      lockForMoneyWrite: async (spaceId) => {
        events.push(`lock ${spaceId}`);
      },
    },
  });
  const existing = anExpense("2026-10-05", 8_500_000n);
  fixture.store.rows.push(existing);
  return { ...fixture, events, existing };
};

const date = "2026-10-06" as LocalDate;
const own = { spaceId: "space-ana", userId: "u-ana" };

describe("the space lock of money writes (issue #89)", () => {
  it.each([
    [
      "RecordExpense",
      (d: ReturnType<typeof setup>["deps"]) =>
        createRecordExpense(d)({
          ...own,
          date,
          amount: money(1_000_000n),
          categoryId: CATEGORIES.groceries.id,
          accountId: ACCOUNTS.bancolombia.id,
        }),
    ],
    [
      "RecordIncome",
      (d: ReturnType<typeof setup>["deps"]) =>
        createRecordIncome(d)({
          ...own,
          date,
          amount: money(1_000_000n),
          categoryId: CATEGORIES.salary.id,
          accountId: ACCOUNTS.bancolombia.id,
        }),
    ],
    [
      "RecordTransfer",
      (d: ReturnType<typeof setup>["deps"]) =>
        createRecordTransfer(d)({
          ...own,
          date,
          amount: money(1_000_000n),
          sourceAccountId: ACCOUNTS.bancolombia.id,
          destinationAccountId: ACCOUNTS.nequi.id,
        }),
    ],
    [
      "RecordSettlement",
      (d: ReturnType<typeof setup>["deps"]) =>
        createRecordSettlement(d)({
          ...own,
          date,
          amount: money(1_000_000n),
          payerMemberId: "member-ana",
          receivingMemberId: "member-ana",
        }),
    ],
    [
      "RecordFundContribution",
      (d: ReturnType<typeof setup>["deps"]) =>
        createRecordFundContribution(d)({
          ...own,
          date,
          amount: money(1_000_000n),
          fundAccountId: ACCOUNTS.householdFund.id,
          sourceAccountId: ACCOUNTS.bancolombia.id,
        }),
    ],
  ])("%s locks the space before it reads the membership", async (_name, write) => {
    const { deps, events } = setup();
    await write(deps);
    expect(events.slice(0, 2)).toEqual(["lock space-ana", "access space-ana"]);
  });

  it("EditTransaction locks the space before it reads the membership", async () => {
    const { deps, events, existing } = setup();
    const edited = await createEditTransaction(deps)({
      ...own,
      transactionId: existing.id,
      expectedVersion: null,
      changes: { amount: money(9_000_000n) },
    });
    expect(codeOf(edited)).toBe("ok");
    expect(events.slice(0, 2)).toEqual(["lock space-ana", "access space-ana"]);
  });

  it("DeleteTransaction locks the space before it reads the membership", async () => {
    const { deps, events, existing } = setup();
    expect(codeOf(await createDeleteTransaction(deps)({ ...own, transactionId: existing.id }))).toBe("ok");
    expect(events.slice(0, 2)).toEqual(["lock space-ana", "access space-ana"]);
  });

  it("asks for the lock before the membership is known, then answers SpaceNotFound to a stranger", async () => {
    const { deps, events } = setup();
    const refused = await createRecordExpense(deps)({
      spaceId: "space-other",
      userId: "u-ana",
      date,
      amount: money(1_000_000n),
      categoryId: CATEGORIES.groceries.id,
      accountId: ACCOUNTS.bancolombia.id,
    });
    expect(codeOf(refused)).toBe("SpaceNotFound");
    expect(events).toEqual(["lock space-other", "access space-other"]);
  });
});
