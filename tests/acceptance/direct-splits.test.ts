import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as directSplit } from "@/app/api/v1/direct-splits/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { GET as getSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type TestUser } from "../support/app";
import { balancesOf, cop, newAccount, type TransactionDto } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface DirectSplitDto {
  spaceId: string;
  created: boolean;
  expense: TransactionDto & { warnings: unknown[] };
}
interface MemberDto {
  id: string;
  kind: string;
  userId: string | null;
  displayName: string;
  role: string | null;
}
type Counterpart =
  { kind: "MEMBER"; memberId: string } | { kind: "GUEST"; displayName: string; contactEmail?: string };

/** A direct split paid in full from `accountId`, dated 2026-10-14, in the seeded category "restaurants". */
const splitBody = (
  accountId: string,
  counterpart: Counterpart,
  description: string,
  pesos: number,
  overrides: Record<string, unknown> = {},
) => ({
  counterpart,
  description,
  date: "2026-10-14",
  categoryKey: "restaurants",
  amount: cop(pesos),
  accountId,
  ...overrides,
});
const split = (user: TestUser, body: unknown, headers: Record<string, string> = {}) =>
  call(directSplit, "POST", "/api/v1/direct-splits", { user, body, headers });
const splitOk = async (response: Response): Promise<DirectSplitDto> => {
  expect(response.status).toBe(201);
  return (await response.json()) as DirectSplitDto;
};
const membersOf = async (user: TestUser, spaceId: string): Promise<MemberDto[]> => {
  const response = await call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, {
    user,
    params: { spaceId },
  });
  return ((await response.json()) as { items: MemberDto[] }).items;
};
/** HU-E1-13 Background: Ana is signed in with her account "Bancolombia". */
const anaWithBancolombia = async () => {
  const ana = await registerUser("Ana");
  return { ana, bancolombia: await newAccount(ana, "Bancolombia", 2_000_000) };
};
const pedroAsGuest: Counterpart = { kind: "GUEST", displayName: "Pedro" };

describe("split with one person through a direct space (HU-E1-13)", () => {
  it("creates 'Ana & Pedro' on the first split with the new guest Pedro, who owes Ana 60,000 COP (@critical)", async () => {
    const { ana, bancolombia } = await anaWithBancolombia();
    const dinner = await splitOk(await split(ana, splitBody(bancolombia, pedroAsGuest, "Dinner", 120_000)));
    expect(dinner.created).toBe(true);
    const space = await call(getSpace, "GET", `/api/v1/spaces/${dinner.spaceId}`, {
      user: ana,
      params: { spaceId: dinner.spaceId },
    });
    expect(await space.json()).toEqual({
      id: dinner.spaceId,
      name: "Ana & Pedro",
      kind: "DIRECT",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
      role: "OWNER",
    });
    const members = await membersOf(ana, dinner.spaceId);
    expect(members.map((m) => [m.displayName, m.kind, m.role])).toEqual([
      ["Ana", "USER", "OWNER"],
      ["Pedro", "GUEST", null],
    ]);
    const [anaId, pedroId] = members.map((m) => m.id) as [string, string];
    expect(dinner.expense).toMatchObject({
      description: "Dinner",
      amount: cop(120_000),
      payments: [{ memberId: anaId, accountId: bancolombia, amount: cop(120_000) }],
      shares: [
        { memberId: anaId, amount: cop(60_000), splitMethod: "EQUAL" },
        { memberId: pedroId, amount: cop(60_000), splitMethod: "EQUAL" },
      ],
      warnings: [],
    });
    expect(await balancesOf(ana, dinner.spaceId)).toEqual([
      [anaId, cop(60_000)],
      [pedroId, cop(-60_000)],
    ]);
  });
});
