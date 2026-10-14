import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { startTestApp, type TestUser } from "../support/app";
import {
  addGuest,
  balanceOf,
  cop,
  household,
  joinHousehold,
  post,
  type Household,
  type HouseholdMember,
  type TransactionDto,
} from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const equal = (...memberIds: string[]) => ({
  method: "EQUAL",
  participants: memberIds.map((memberId) => ({ memberId })),
});
/** An expense of `pesos` in Household paid in full by `payer` from their own account. */
const paidBy = (
  h: Household,
  payer: HouseholdMember,
  pesos: number,
  extra: Record<string, unknown> = {},
) => ({
  description: "Groceries",
  date: "2026-10-05",
  categoryId: h.groceries,
  amount: cop(pesos),
  payments: [{ memberId: payer.memberId, accountId: payer.account, amount: cop(pesos) }],
  ...extra,
});
const sharesOf = (tx: TransactionDto) => tx.shares.map((s) => [s.memberId, s.amount, s.splitMethod]);
const recordedBy = async (user: TestUser, body: unknown): Promise<TransactionDto> => {
  const response = await post(recordExpense, user, "expenses", body);
  expect(response.status).toBe(201);
  return (await response.json()) as TransactionDto;
};

describe("shared expense split equally (HU-E4-07)", () => {
  it("records Ana's payment and equal shares for Ana and Juan (@critical)", async () => {
    const h = await household();
    const tx = await recordedBy(
      h.ana,
      paidBy(h, h.ana, 300_000, { split: equal(h.ana.memberId, h.juan.memberId) }),
    );
    expect(tx.payments).toEqual([
      { memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(300_000) },
    ]);
    expect(sharesOf(tx)).toEqual([
      [h.ana.memberId, cop(150_000), "EQUAL"],
      [h.juan.memberId, cop(150_000), "EQUAL"],
    ]);
    // D9: the shared expense leaves Ana's personal account.
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(cop(1_700_000));
  });

  it("gives the remainder peso to the earliest-joined member, whatever the request order (Review Focus 1)", async () => {
    const h = await household();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    const split = equal(luis.memberId, h.juan.memberId, h.ana.memberId);
    const tx = await recordedBy(h.ana, paidBy(h, h.ana, 100_000, { split }));
    expect(sharesOf(tx)).toEqual([
      [h.ana.memberId, cop(33_334), "EQUAL"],
      [h.juan.memberId, cop(33_333), "EQUAL"],
      [luis.memberId, cop(33_333), "EQUAL"],
    ]);
  });

  it("lets the payer stay out of the split", async () => {
    const h = await household();
    const tx = await recordedBy(h.ana, paidBy(h, h.ana, 80_000, { split: equal(h.juan.memberId) }));
    expect(sharesOf(tx)).toEqual([[h.juan.memberId, cop(80_000), "EQUAL"]]);
  });

  it("records a taxi paid by the guest Pedro outside the app", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    const tx = await recordedBy(h.ana, {
      description: "Taxi",
      date: "2026-10-05",
      categoryId: h.groceries,
      amount: cop(90_000),
      payments: [{ memberId: pedro, accountId: null, amount: cop(90_000) }],
      split: equal(h.ana.memberId, h.juan.memberId, pedro),
    });
    expect(tx.payments).toEqual([{ memberId: pedro, accountId: null, amount: cop(90_000) }]);
    expect(sharesOf(tx)).toEqual([
      [h.ana.memberId, cop(30_000), "EQUAL"],
      [h.juan.memberId, cop(30_000), "EQUAL"],
      [pedro, cop(30_000), "EQUAL"],
    ]);
    expect(tx.createdBy).toBe(h.ana.userId);
  });

  it("shares equally among every current member when the split is omitted (spec 5.3)", async () => {
    const h = await household();
    const tx = await recordedBy(h.ana, paidBy(h, h.ana, 300_000));
    expect(sharesOf(tx)).toEqual([
      [h.ana.memberId, cop(150_000), "EQUAL"],
      [h.juan.memberId, cop(150_000), "EQUAL"],
    ]);
  });
});
