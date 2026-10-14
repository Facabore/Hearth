import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import {
  DELETE as deleteTransaction,
  PATCH as editTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  addGuest,
  balanceOf,
  balancesOf,
  cop,
  household,
  joinHousehold,
  memberIdOf,
  post,
  type Household,
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

/** Ana pays `pesos` from Bancolombia, split equally among `participants`. */
const anaPays = async (h: Household, pesos: number, participants: string[]) => {
  const response = await post(recordExpense, h.ana, "expenses", {
    description: "Rent",
    date: "2026-10-01",
    categoryId: h.groceries,
    amount: cop(pesos),
    payments: [{ memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(pesos) }],
    split: { method: "EQUAL", participants: participants.map((memberId) => ({ memberId })) },
  });
  expect(response.status).toBe(201);
};
/** HU-E5-02 Background: Household where Juan owes Ana 1,200,000 COP. */
const juanOwesAna = async (): Promise<Household> => {
  const h = await household();
  await anaPays(h, 2_400_000, [h.ana.memberId, h.juan.memberId]);
  return h;
};
const settle = (user: TestUser, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  post(recordSettlement, user, "settlements", { date: "2026-10-30", ...body }, headers);
const juanToAna = (h: Household, pesos: number, extra: Record<string, unknown> = {}) => ({
  amount: cop(pesos),
  payerMemberId: h.juan.memberId,
  receivingMemberId: h.ana.memberId,
  ...extra,
});
const settled = async (response: Response): Promise<TransactionDto> => {
  expect(response.status).toBe(201);
  return (await response.json()) as TransactionDto;
};

describe("settlements (HU-E5-02)", () => {
  it("clears the balance with a full settlement (@critical)", async () => {
    const h = await juanOwesAna();
    const tx = await settled(await settle(h.juan, juanToAna(h, 1_200_000)));
    expect(tx).toMatchObject({
      type: "SETTLEMENT",
      categoryId: null,
      date: "2026-10-30",
      amount: cop(1_200_000),
      payerMemberId: h.juan.memberId,
      receivingMemberId: h.ana.memberId,
      payments: [],
      shares: [],
      createdBy: h.juan.userId,
    });
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
    ]);
  });

  it("reduces the debt with a partial settlement and reverses it when Juan pays too much", async () => {
    const h = await juanOwesAna();
    await settled(await settle(h.juan, juanToAna(h, 500_000)));
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(700_000)],
      [h.juan.memberId, cop(-700_000)],
    ]);
    await settled(await settle(h.juan, juanToAna(h, 800_000)));
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(-100_000)],
      [h.juan.memberId, cop(100_000)],
    ]);
  });

  it("moves money from Juan's Davivienda to Ana's Bancolombia when Juan records it (D9: a credit to Ana)", async () => {
    const h = await juanOwesAna();
    const withAccounts = juanToAna(h, 1_200_000, {
      sourceAccountId: h.juan.account,
      destinationAccountId: h.ana.account,
    });
    await settled(await settle(h.juan, withAccounts));
    expect(await balanceOf(h.juan.personal, h.juan.account)).toEqual(cop(800_000));
    // Bancolombia: 2,000,000 − 2,400,000 rent + 1,200,000 settlement.
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(cop(800_000));
  });

  it("lets Ana record a settlement paid by the guest Pedro, who has no account", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    await anaPays(h, 200_000, [h.ana.memberId, pedro]);
    const tx = await settled(
      await settle(h.ana, { amount: cop(100_000), payerMemberId: pedro, receivingMemberId: h.ana.memberId }),
    );
    expect(tx).toMatchObject({ payerMemberId: pedro, sourceAccountId: null, createdBy: h.ana.userId });
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
      [pedro, cop(0)],
    ]);
  });

  it("answers invalid settlements with stable codes and settles nothing (Review Focus 2)", async () => {
    const h = await juanOwesAna();
    const pedro = await addGuest(h, "Pedro");
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    const marta = await registerUser("Marta");
    const martasMember = await memberIdOf(marta, marta.spaceId, "Marta");
    const cases: [TestUser, unknown, number, string][] = [
      [
        h.juan,
        juanToAna(h, 100_000, { receivingMemberId: h.juan.memberId }),
        422,
        "InvalidSettlementParties",
      ],
      [h.juan, juanToAna(h, 100_000, { receivingMemberId: martasMember }), 422, "NotASpaceMember"],
      [h.juan, juanToAna(h, 100_000, { payerMemberId: "not-a-uuid" }), 422, "NotASpaceMember"],
      [h.juan, juanToAna(h, 100_000, { sourceAccountId: h.ana.account }), 422, "AccountNotOwned"],
      // D9: Ana cannot settle Juan's debt from Juan's account (Juan crediting Ana's account is allowed).
      [h.ana, juanToAna(h, 100_000, { sourceAccountId: h.juan.account }), 422, "AccountNotOwned"],
      [
        h.ana,
        juanToAna(h, 100_000, { payerMemberId: pedro, sourceAccountId: h.ana.account }),
        409,
        "GuestHasNoAccounts",
      ],
      [h.juan, juanToAna(h, 0), 422, "InvalidAmount"],
      [sofi, juanToAna(h, 100_000), 403, "InsufficientRole"],
    ];
    for (const [user, body, status, code] of cases) {
      expect(await problemOf(await settle(user, body as Record<string, unknown>))).toEqual([status, code]);
    }
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(1_200_000)],
      [h.juan.memberId, cop(-1_200_000)],
      [pedro, cop(0)],
      [sofi.memberId, cop(0)],
    ]);
  });

  it("answers a non-member with 404 SpaceNotFound and settles nothing", async () => {
    const h = await juanOwesAna();
    const marta = await registerUser("Marta");
    const body = { date: "2026-10-30", ...juanToAna(h, 100_000) };
    const response = await post(recordSettlement, marta, "settlements", body, {}, h.ana);
    expect(await problemOf(response)).toEqual([404, "SpaceNotFound"]);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(1_200_000)],
      [h.juan.memberId, cop(-1_200_000)],
    ]);
  });

  it("replays a repeated Idempotency-Key and settles once (Review Focus 4)", async () => {
    const h = await juanOwesAna();
    const key = { "idempotency-key": "settle-up-2026-10" };
    const first = await settle(h.juan, juanToAna(h, 1_200_000), key);
    const second = await settle(h.juan, juanToAna(h, 1_200_000), key);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(await second.json()).toEqual(await first.json());
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
    ]);
    expect(await problemOf(await settle(h.juan, juanToAna(h, 1_000_000), key))).toEqual([
      409,
      "IdempotencyKeyConflict",
    ]);
  });

  it("restores the debt when the settlement is deleted, and never takes a category (Review Focus 5)", async () => {
    const h = await juanOwesAna();
    const tx = await settled(await settle(h.juan, juanToAna(h, 1_200_000)));
    const path = `/api/v1/spaces/${h.spaceId}/transactions/${tx.id}`;
    const params = { spaceId: h.spaceId, transactionId: tx.id };
    const withCategory = await call(editTransaction, "PATCH", path, {
      user: h.juan,
      params,
      body: { categoryId: h.groceries },
    });
    expect(await problemOf(withCategory)).toEqual([409, "SettlementHasNoCategory"]);
    expect((await call(deleteTransaction, "DELETE", path, { user: h.juan, params })).status).toBe(204);
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(1_200_000)],
      [h.juan.memberId, cop(-1_200_000)],
    ]);
  });

  it("lists settlements by type without counting them as spending", async () => {
    const h = await juanOwesAna();
    const tx = await settled(await settle(h.juan, juanToAna(h, 1_200_000)));
    const query = async (filter: string) => {
      const response = await call(
        listTransactions,
        "GET",
        `/api/v1/spaces/${h.spaceId}/transactions?period=2026-10${filter}`,
        {
          user: h.ana,
          params: { spaceId: h.spaceId },
        },
      );
      return (await response.json()) as { items: TransactionDto[]; totals: { expenses: { amount: string } } };
    };
    expect((await query("&type=SETTLEMENT")).items.map((t) => t.id)).toEqual([tx.id]);
    expect((await query("")).totals.expenses).toEqual(cop(2_400_000));
  });
});
