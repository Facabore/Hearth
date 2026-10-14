import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import {
  GET as getTransaction,
  PATCH as editTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { actingIn } from "../support/spaces";
import {
  addGuest,
  balanceOf,
  cop,
  household,
  joinHousehold,
  memberIdOf,
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

describe("shared expense rules (HU-E4-07, Review Focus 2)", () => {
  it("answers invalid payers and participants with stable codes and leaves Ana's account untouched", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    const marta = await registerUser("Marta");
    const martasMember = await memberIdOf(marta, marta.spaceId, "Marta");
    const both = equal(h.ana.memberId, h.juan.memberId);
    const juanPays = (accountId: string | undefined, pesos = 80_000) => [
      { memberId: h.juan.memberId, accountId, amount: cop(pesos) },
    ];
    const cases: [unknown, number, string][] = [
      [paidBy(h, h.ana, 80_000, { split: equal(h.ana.memberId, martasMember) }), 422, "NotASpaceMember"],
      [paidBy(h, h.ana, 80_000, { split: equal("not-a-uuid") }), 422, "NotASpaceMember"],
      [
        paidBy(h, h.ana, 80_000, {
          split: both,
          payments: [{ memberId: martasMember, accountId: null, amount: cop(80_000) }],
        }),
        422,
        "NotASpaceMember",
      ],
      [paidBy(h, h.ana, 80_000, { split: equal() }), 422, "ParticipantsRequired"],
      [paidBy(h, h.ana, 80_000, { split: equal(h.ana.memberId, h.ana.memberId) }), 422, "InvalidSplit"],
      [paidBy(h, h.ana, 80_000, { split: both, payments: [] }), 422, "PaymentsRequired"],
      [paidBy(h, h.ana, 80_000, { split: both, payments: juanPays(h.ana.account) }), 422, "AccountNotOwned"],
      // D9: Ana cannot spend from Juan's own account either; Juan records his own payment (last test).
      [paidBy(h, h.ana, 80_000, { split: both, payments: juanPays(h.juan.account) }), 422, "AccountNotOwned"],
      [paidBy(h, h.ana, 80_000, { split: both, payments: juanPays(undefined) }), 422, "AccountRequired"],
      // Neither accountId nor payments: the requester pays, but names no account of theirs.
      [paidBy(h, h.ana, 80_000, { split: both, payments: undefined }), 422, "AccountRequired"],
      [
        paidBy(h, h.ana, 80_000, {
          split: both,
          payments: [
            { memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(40_000) },
            { memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(40_000) },
          ],
        }),
        422,
        "InvalidSplit",
      ],
      [
        paidBy(h, h.ana, 80_000, {
          split: both,
          payments: [{ memberId: pedro, accountId: h.ana.account, amount: cop(80_000) }],
        }),
        409,
        "GuestHasNoAccounts",
      ],
      [
        paidBy(h, h.ana, 80_000, {
          split: both,
          payments: [{ memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(70_000) }],
        }),
        409,
        "SharesDoNotMatchAmount",
      ],
      [paidBy(h, h.ana, 80_000, { split: both, accountId: h.ana.account }), 422, "ValidationFailed"],
    ];
    for (const [body, status, code] of cases) {
      expect(await problemOf(await post(recordExpense, h.ana, "expenses", body))).toEqual([status, code]);
    }
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(cop(2_000_000));
  });

  it("lets members record for guests, but not viewers, and hides the space from non-members", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    const marta = await registerUser("Marta");
    const byPedro = {
      description: "Taxi",
      date: "2026-10-05",
      categoryId: h.groceries,
      amount: cop(90_000),
      payments: [{ memberId: pedro, accountId: null, amount: cop(90_000) }],
      split: equal(luis.memberId, pedro),
    };
    expect((await post(recordExpense, luis, "expenses", byPedro)).status).toBe(201);
    expect(await problemOf(await post(recordExpense, sofi, "expenses", byPedro))).toEqual([
      403,
      "InsufficientRole",
    ]);
    expect(
      await problemOf(await post(recordExpense, actingIn(marta, h.spaceId), "expenses", byPedro)),
    ).toEqual([404, "SpaceNotFound"]);
  });

  it("lets Juan record his own payment and filters the household's transactions by payer (HU-E4-05)", async () => {
    const h = await household();
    const split = equal(h.ana.memberId, h.juan.memberId);
    await recordedBy(h.ana, paidBy(h, h.ana, 300_000, { split }));
    const juans = await recordedBy(h.juan, paidBy(h, h.juan, 100_000, { split }));
    const path = `/api/v1/spaces/${h.spaceId}/transactions?period=2026-10&payerMemberId=${h.juan.memberId}`;
    const response = await call(listTransactions, "GET", path, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    const { items } = (await response.json()) as { items: TransactionDto[] };
    expect(items.map((t) => t.id)).toEqual([juans.id]);
  });
});

describe("editing a shared expense (HU-E4-06, D9)", () => {
  it("refuses an ADMIN changing the amount Juan paid from his own account, but lets them fix the description", async () => {
    const h = await household();
    const luis = await joinHousehold(h, "Luis", "ADMIN");
    const tx = await recordedBy(h.juan, paidBy(h, h.juan, 100_000, { split: equal(h.ana.memberId) }));
    const path = `/api/v1/spaces/${h.spaceId}/transactions/${tx.id}`;
    const params = { spaceId: h.spaceId, transactionId: tx.id };
    const asLuis = (body: unknown) => call(editTransaction, "PATCH", path, { user: luis, params, body });
    expect(await problemOf(await asLuis({ amount: cop(150_000) }))).toEqual([422, "AccountNotOwned"]);
    expect(await balanceOf(h.juan.personal, h.juan.account)).toEqual(cop(1_900_000));
    const current = (await (
      await call(getTransaction, "GET", path, { user: h.juan, params })
    ).json()) as TransactionDto;
    expect([current.amount, current.version]).toEqual([cop(100_000), 1]);
    const renamed = await asLuis({ description: "Market" });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as TransactionDto).description).toBe("Market");
    expect(await balanceOf(h.juan.personal, h.juan.account)).toEqual(cop(1_900_000));
  });
});

describe("non-equal splits (HU-E4-08)", () => {
  const byAna = (h: Household, pesos: number, split: unknown) => paidBy(h, h.ana, pesos, { split });

  it("splits by percentage, exact amounts and share units", async () => {
    const h = await household();
    const [ana, juan] = [h.ana.memberId, h.juan.memberId];
    const percent = await recordedBy(
      h.ana,
      byAna(h, 300_000, {
        method: "PERCENT",
        participants: [
          { memberId: ana, percent: "40" },
          { memberId: juan, percent: "60" },
        ],
      }),
    );
    expect(sharesOf(percent)).toEqual([
      [ana, cop(120_000), "PERCENT"],
      [juan, cop(180_000), "PERCENT"],
    ]);
    const exact = await recordedBy(
      h.ana,
      byAna(h, 250_000, {
        method: "EXACT",
        participants: [
          { memberId: ana, amount: cop(100_000) },
          { memberId: juan, amount: cop(150_000) },
        ],
      }),
    );
    expect(sharesOf(exact)).toEqual([
      [ana, cop(100_000), "EXACT"],
      [juan, cop(150_000), "EXACT"],
    ]);
    const units = await recordedBy(
      h.ana,
      byAna(h, 90_000, {
        method: "SHARES",
        participants: [
          { memberId: ana, units: 2 },
          { memberId: juan, units: 1 },
        ],
      }),
    );
    expect(sharesOf(units)).toEqual([
      [ana, cop(60_000), "SHARES"],
      [juan, cop(30_000), "SHARES"],
    ]);
  });

  it("accepts percentages with two decimals and still sums exactly (Review Focus 1)", async () => {
    const h = await household();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    const tx = await recordedBy(
      h.ana,
      // 100,001 pesos: 33,330.3333 / 33,330.3333 / 33,340.3334, so the leftover peso goes to the largest fraction.
      byAna(h, 100_001, {
        method: "PERCENT",
        participants: [
          { memberId: h.ana.memberId, percent: "33.33" },
          { memberId: h.juan.memberId, percent: "33.33" },
          { memberId: luis.memberId, percent: "33.34" },
        ],
      }),
    );
    expect(sharesOf(tx)).toEqual([
      [h.ana.memberId, cop(33_330), "PERCENT"],
      [h.juan.memberId, cop(33_330), "PERCENT"],
      [luis.memberId, cop(33_341), "PERCENT"],
    ]);
    const total = tx.shares.reduce((sum, s) => sum + BigInt(s.amount.amount), 0n);
    expect([String(total), tx.amount.amount]).toEqual(["10000100", "10000100"]);
  });

  it("rejects splits that do not add up or are malformed", async () => {
    const h = await household();
    const [ana, juan] = [h.ana.memberId, h.juan.memberId];
    const cases: [unknown, number, string][] = [
      [
        byAna(h, 300_000, {
          method: "PERCENT",
          participants: [
            { memberId: ana, percent: "40" },
            { memberId: juan, percent: "50" },
          ],
        }),
        422,
        "InvalidSplit",
      ],
      [
        byAna(h, 250_000, {
          method: "EXACT",
          participants: [
            { memberId: ana, amount: cop(100_000) },
            { memberId: juan, amount: cop(120_000) },
          ],
        }),
        409,
        "SharesDoNotMatchAmount",
      ],
      [
        byAna(h, 90_000, {
          method: "SHARES",
          participants: [
            { memberId: ana, units: 0 },
            { memberId: juan, units: 0 },
          ],
        }),
        422,
        "InvalidSplit",
      ],
      [
        byAna(h, 300_000, {
          method: "PERCENT",
          participants: [
            { memberId: ana, percent: "40%" },
            { memberId: juan, percent: "60" },
          ],
        }),
        422,
        "ValidationFailed",
      ],
      [
        byAna(h, 90_000, {
          method: "SHARES",
          participants: [
            { memberId: ana, units: 1.5 },
            { memberId: juan, units: 1 },
          ],
        }),
        422,
        "ValidationFailed",
      ],
      [
        byAna(h, 250_000, {
          method: "EXACT",
          participants: [
            { memberId: ana, amount: cop(100_000) },
            { memberId: juan, amount: { amount: "15000000", currency: "USD" } },
          ],
        }),
        422,
        "CurrencyMismatch",
      ],
    ];
    for (const [body, status, code] of cases) {
      expect(await problemOf(await post(recordExpense, h.ana, "expenses", body))).toEqual([status, code]);
    }
  });
});
