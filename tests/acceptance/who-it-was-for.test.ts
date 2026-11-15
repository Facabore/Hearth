import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as directSplit } from "@/app/api/v1/direct-splits/route";
import { GET as listSpaces } from "@/app/api/v1/spaces/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, startTestApp, type TestUser } from "../support/app";
import {
  balancesOf,
  cop,
  household,
  joinHousehold,
  paysEqually,
  type Household,
  type MoneyDto,
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

type Counterpart = { kind: "MEMBER"; memberId: string } | { kind: "GUEST"; displayName: string };
interface Recorded {
  spaceId: string;
  created: boolean;
  expense: TransactionDto;
}
type WhoItWasForDto = Recorded & Record<string, unknown>;

const juanOf = (h: Household): Counterpart => ({ kind: "MEMBER", memberId: h.juan.memberId });
const pedro: Counterpart = { kind: "GUEST", displayName: "Pedro" };

/** Ana's dinner on 2026-10-14, paid in full from her personal account, in the seeded category "restaurants". */
const dinner = (h: Household, pesos: number, counterpart: Counterpart, parts?: unknown) => ({
  counterpart,
  description: "Cena",
  date: "2026-10-14",
  categoryKey: "restaurants",
  amount: cop(pesos),
  accountId: h.ana.account,
  ...(parts === undefined ? {} : { parts }),
});
const record = (user: TestUser, body: unknown) =>
  call(directSplit, "POST", "/api/v1/direct-splits", { user, body });
const recorded = async (response: Response): Promise<WhoItWasForDto> => {
  expect(response.status).toBe(201);
  return (await response.json()) as WhoItWasForDto;
};
const directSpacesOf = async (user: TestUser) => {
  const response = await call(listSpaces, "GET", "/api/v1/spaces", { user });
  const { items } = (await response.json()) as { items: { id: string; kind: string; name: string }[] };
  return items.filter((s) => s.kind === "DIRECT").map((s) => s.name);
};
/** The member ids of a direct space, Ana's first (she created it). */
const pairOf = async (user: TestUser, spaceId: string): Promise<[string, string]> => {
  const response = await call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, {
    user,
    params: { spaceId },
  });
  const { items } = (await response.json()) as { items: { id: string }[] };
  return items.map((m) => m.id) as [string, string];
};

describe("who an expense was for, with one other person (P331, HU-E1-13)", () => {
  it("records it all for Juan when Tú is not ticked: Juan owes Ana the whole 120,000 COP", async () => {
    const h = await household();
    const body = dinner(h, 120_000, juanOf(h), { mine: cop(0), theirs: cop(120_000) });
    const split = await recorded(await record(h.ana, body));
    const [ana, juan] = await pairOf(h.ana, split.spaceId);
    expect(split.expense).toMatchObject({
      amount: cop(120_000),
      payments: [{ memberId: ana, accountId: h.ana.account, amount: cop(120_000) }],
      shares: [{ memberId: juan, amount: cop(120_000) }],
    });
    expect(await balancesOf(h.ana, split.spaceId)).toEqual([
      [ana, cop(120_000)],
      [juan, cop(-120_000)],
    ]);
  });

  it("keeps half and half when Tú and one person split equally and no parts are sent (HU-E1-13 unchanged)", async () => {
    const h = await household();
    const split = await recorded(await record(h.ana, dinner(h, 120_000, juanOf(h))));
    const [ana, juan] = await pairOf(h.ana, split.spaceId);
    expect(split.expense.shares).toEqual([
      { memberId: ana, amount: cop(60_000), splitMethod: "EQUAL" },
      { memberId: juan, amount: cop(60_000), splitMethod: "EQUAL" },
    ]);
    expect(await balancesOf(h.ana, split.spaceId)).toEqual([
      [ana, cop(60_000)],
      [juan, cop(-60_000)],
    ]);
  });

  it("records Montos or Porcentaje parts as typed: Ana 50,000 and the new guest Pedro 70,000", async () => {
    const h = await household();
    const body = dinner(h, 120_000, pedro, { mine: cop(50_000), theirs: cop(70_000) });
    const split = await recorded(await record(h.ana, body));
    const [ana, guest] = await pairOf(h.ana, split.spaceId);
    expect(split.created).toBe(true);
    expect(split.expense.shares.map((s) => [s.memberId, s.amount])).toEqual([
      [ana, cop(50_000)],
      [guest, cop(70_000)],
    ]);
    expect(await balancesOf(h.ana, split.spaceId)).toEqual([
      [ana, cop(70_000)],
      [guest, cop(-70_000)],
    ]);
  });
});

describe("parts that cannot be (P331)", () => {
  it("refuses parts that do not add up, a person's part that is not positive and another currency", async () => {
    const h = await household();
    const refusals: [unknown, [number, string]][] = [
      [{ mine: cop(0), theirs: cop(70_000) }, [409, "SharesDoNotMatchAmount"]],
      [{ mine: cop(120_000), theirs: cop(0) }, [422, "InvalidSplit"]],
      [{ mine: cop(-10_000), theirs: cop(130_000) }, [422, "InvalidSplit"]],
      [{ mine: { amount: "0", currency: "USD" }, theirs: cop(120_000) }, [422, "CurrencyMismatch"]],
    ];
    for (const [parts, problem] of refusals)
      expect(await problemOf(await record(h.ana, dinner(h, 120_000, juanOf(h), parts)))).toEqual(problem);
    expect(await directSpacesOf(h.ana)).toEqual([]);
  });
});

describe("a shared space's split may leave the payer out (P331, S5)", () => {
  it("records Ana's 90,000 COP for Juan and Luis only, and Saldos shows both owing Ana", async () => {
    const h = await household();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    const expense = await paysEqually(h.ana, 90_000, [h.juan.memberId, luis.memberId], h.groceries);
    expect(expense.shares.map((s) => s.memberId)).toEqual([h.juan.memberId, luis.memberId]);
    const net = Object.fromEntries(await balancesOf(h.ana, h.spaceId)) as Record<string, MoneyDto>;
    expect(net).toEqual({
      [h.ana.memberId]: cop(90_000),
      [h.juan.memberId]: cop(-45_000),
      [luis.memberId]: cop(-45_000),
    });
  });
});
