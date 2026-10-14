import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordContribution } from "@/app/api/v1/spaces/[spaceId]/fund-contributions/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  addGuest,
  balanceOf,
  balancesOf,
  cop,
  household,
  joinHousehold,
  newAccount,
  post,
  type Household,
  type TransactionDto,
} from "../support/ledger";
import { actingIn } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface FundHousehold extends Household {
  readonly fund: string;
}

/** HU-E4-09 Background: Household with Ana and Juan and the empty SHARED_FUND account "Household Fund". */
const withFund = async (): Promise<FundHousehold> => {
  const h = await household();
  return { ...h, fund: await newAccount(h.ana, "Household Fund", 0, "SHARED_FUND") };
};
/** `pesos` into the fund on 2026-10-02, from Ana's Bancolombia unless `extra` says otherwise. */
const contribution = (h: FundHousehold, pesos: number, extra: Record<string, unknown> = {}) => ({
  date: "2026-10-02",
  amount: cop(pesos),
  fundAccountId: h.fund,
  sourceAccountId: h.ana.account,
  ...extra,
});
const contribute = (user: TestUser, body: unknown, headers: Record<string, string> = {}) =>
  post(recordContribution, user, "fund-contributions", body, headers);

describe("fund contributions (HU-E4-09)", () => {
  it("records Ana's transfer from her personal account into Household Fund", async () => {
    const h = await withFund();
    const response = await contribute(h.ana, contribution(h, 480_000));
    expect(response.status).toBe(201);
    expect((await response.json()) as TransactionDto).toMatchObject({
      type: "TRANSFER",
      categoryId: null,
      amount: cop(480_000),
      payerMemberId: h.ana.memberId,
      sourceAccountId: h.ana.account,
      destinationAccountId: h.fund,
      createdBy: h.ana.userId,
    });
    expect(await balanceOf(h.ana, h.fund)).toEqual(cop(480_000));
    expect(await balanceOf(h.ana.personal, h.ana.account)).toEqual(cop(1_520_000));
  });

  it("requires the contributor's own account, debited only by its owner (D9)", async () => {
    const h = await withFund();
    const fromJuans = contribution(h, 480_000, { sourceAccountId: h.juan.account });
    expect(await problemOf(await contribute(h.ana, fromJuans))).toEqual([422, "AccountNotOwned"]);
    // Ana cannot record Juan's contribution from Juan's account; Juan records it himself.
    const juans = { ...fromJuans, memberId: h.juan.memberId };
    expect(await problemOf(await contribute(h.ana, juans))).toEqual([422, "AccountNotOwned"]);
    expect((await contribute(h.juan, juans)).status).toBe(201);
    expect(await balanceOf(h.ana, h.fund)).toEqual(cop(480_000));
  });

  it("does not let a viewer contribute", async () => {
    const h = await withFund();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    const fromSofi = contribution(h, 100_000, { sourceAccountId: sofi.account });
    expect(await problemOf(await contribute(sofi, fromSofi))).toEqual([403, "InsufficientRole"]);
  });

  it("raises the fund and leaves every member's net unchanged (D5)", async () => {
    const h = await withFund();
    expect((await contribute(h.ana, contribution(h, 480_000))).status).toBe(201);
    expect(await balanceOf(h.ana, h.fund)).toEqual(cop(480_000));
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(0)],
    ]);
  });

  it("records a guest's contribution from outside the app", async () => {
    const h = await withFund();
    const pedro = await addGuest(h, "Pedro");
    const response = await contribute(
      h.ana,
      contribution(h, 100_000, { memberId: pedro, sourceAccountId: null }),
    );
    expect(response.status).toBe(201);
    expect((await response.json()) as TransactionDto).toMatchObject({
      payerMemberId: pedro,
      sourceAccountId: null,
    });
    expect(await problemOf(await contribute(h.ana, contribution(h, 100_000, { memberId: pedro })))).toEqual([
      409,
      "GuestHasNoAccounts",
    ]);
    expect(await balanceOf(h.ana, h.fund)).toEqual(cop(100_000));
  });

  it("replays a repeated Idempotency-Key and moves the fund once (Review Focus 4)", async () => {
    const h = await withFund();
    const key = { "idempotency-key": "fund-2026-10" };
    const first = await contribute(h.ana, contribution(h, 480_000), key);
    const second = await contribute(h.ana, contribution(h, 480_000), key);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(await second.json()).toEqual(await first.json());
    expect(await balanceOf(h.ana, h.fund)).toEqual(cop(480_000));
    expect(await problemOf(await contribute(h.ana, contribution(h, 500_000), key))).toEqual([
      409,
      "IdempotencyKeyConflict",
    ]);
  });

  it("accepts only this household's fund (Review Focus 3)", async () => {
    const h = await withFund();
    const other = await withFund();
    for (const fundAccountId of [other.fund, "not-a-uuid", h.ana.account]) {
      expect(await problemOf(await contribute(h.ana, contribution(h, 100_000, { fundAccountId })))).toEqual([
        404,
        "AccountNotFound",
      ]);
    }
    expect(await balanceOf(h.ana, h.fund)).toEqual(cop(0));
  });

  it("hides the household from a non-member as SpaceNotFound", async () => {
    const h = await withFund();
    const marta = actingIn(await registerUser("Marta"), h.spaceId);
    expect(await problemOf(await contribute(marta, contribution(h, 100_000)))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    expect(await balanceOf(h.ana, h.fund)).toEqual(cop(0));
  });
});
