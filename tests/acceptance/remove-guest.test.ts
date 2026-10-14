import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as acceptClaim } from "@/app/api/v1/claims/[token]/accept/route";
import { DELETE as removeGuestMember } from "@/app/api/v1/spaces/[spaceId]/guests/[memberId]/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { GET as getTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  addGuest,
  balancesOf,
  cop,
  household,
  joinHousehold,
  paysEqually,
  settles,
  type Household,
  type HouseholdMember,
  type TransactionDto,
} from "../support/ledger";
import { claimLink } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface Background {
  readonly h: Household;
  readonly luis: HouseholdMember;
  readonly sofi: HouseholdMember;
  readonly pedro: string;
}
/** HU-E1-12 Background: Household with OWNER Ana, MEMBER Luis, VIEWER Sofi and the guest Pedro (and MEMBER Juan). */
const background = async (): Promise<Background> => {
  const h = await household();
  const luis = await joinHousehold(h, "Luis", "MEMBER");
  const sofi = await joinHousehold(h, "Sofi", "VIEWER");
  return { h, luis, sofi, pedro: await addGuest(h, "Pedro") };
};
const remove = (user: TestUser, spaceId: string, memberId: string) =>
  call(removeGuestMember, "DELETE", `/api/v1/spaces/${spaceId}/guests/${memberId}`, {
    user,
    params: { spaceId, memberId },
  });
const memberRow = async (id: string) =>
  (await app.pool.query("SELECT kind, display_name, left_at FROM space_members WHERE id = $1", [id])).rows[0];
const currentIds = async (user: TestUser, spaceId: string): Promise<string[]> => {
  const response = await call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, {
    user,
    params: { spaceId },
  });
  return ((await response.json()) as { items: { id: string }[] }).items.map((m) => m.id);
};

describe("remove a guest (HU-E1-12)", () => {
  it("lets Luis remove Pedro, whose balance is zero, and frees the name for a new guest", async () => {
    const { h, luis, pedro } = await background();
    expect((await remove(luis, h.spaceId, pedro)).status).toBe(204);
    expect((await memberRow(pedro)).left_at).toBeInstanceOf(Date);
    expect(await currentIds(h.ana, h.spaceId)).not.toContain(pedro);
    expect(await addGuest(h, "Pedro")).not.toBe(pedro);
  });

  it("refuses removing Pedro while he owes Ana 100,000 COP, stating the amount (Review Focus 1)", async () => {
    const { h, pedro } = await background();
    await paysEqually(h.ana, 200_000, [h.ana.memberId, pedro], h.groceries);
    const response = await remove(h.ana, h.spaceId, pedro);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "OutstandingBalance", outstanding: cop(100_000) });
    expect((await memberRow(pedro)).left_at).toBeNull();
  });

  it("keeps Pedro's name, kind, Hotel share and place in the balances after he settled and was removed", async () => {
    const { h, luis, sofi, pedro } = await background();
    const hotel = await paysEqually(
      h.ana,
      300_000,
      [h.ana.memberId, luis.memberId, pedro],
      h.groceries,
      "Hotel",
    );
    await settles(h.ana, pedro, h.ana.memberId, 100_000);
    expect((await remove(h.ana, h.spaceId, pedro)).status).toBe(204);
    const read = await call(getTransaction, "GET", `/api/v1/spaces/${h.spaceId}/transactions/${hotel.id}`, {
      user: h.ana,
      params: { spaceId: h.spaceId, transactionId: hotel.id },
    });
    expect(((await read.json()) as TransactionDto).shares).toContainEqual({
      memberId: pedro,
      amount: cop(100_000),
      splitMethod: "EQUAL",
    });
    expect(await memberRow(pedro)).toMatchObject({ kind: "GUEST", display_name: "Pedro" });
    // Former members stay in the balances while the totals mention them (M2-B), here settled at 0.
    expect(await balancesOf(h.ana, h.spaceId)).toEqual([
      [h.ana.memberId, cop(100_000)],
      [h.juan.memberId, cop(0)],
      [luis.memberId, cop(-100_000)],
      [sofi.memberId, cop(0)],
      [pedro, cop(0)],
    ]);
  });

  it("does not let a viewer remove a guest, and never removes a registered member as one", async () => {
    const { h, luis, sofi, pedro } = await background();
    expect(await problemOf(await remove(sofi, h.spaceId, pedro))).toEqual([403, "InsufficientRole"]);
    expect(await problemOf(await remove(h.ana, h.spaceId, luis.memberId))).toEqual([409, "NotAGuest"]);
  });

  it("revokes Pedro's pending claim links (Review Focus 2)", async () => {
    const { h, pedro } = await background();
    const link = await claimLink(h.ana, h.spaceId, pedro);
    expect((await remove(h.ana, h.spaceId, pedro)).status).toBe(204);
    const marta = await registerUser("Marta");
    const claimed = await call(acceptClaim, "POST", `/api/v1/claims/${link.token}/accept`, {
      user: marta,
      params: { token: link.token },
    });
    expect(await problemOf(claimed)).toEqual([409, "InvitationRevoked"]);
  });

  it("answers 404 for unknown and malformed members and for non-members", async () => {
    const { h, pedro } = await background();
    for (const memberId of ["0190a0b0-0000-7000-8000-000000000000", "not-a-uuid"]) {
      expect(await problemOf(await remove(h.ana, h.spaceId, memberId))).toEqual([404, "MemberNotFound"]);
    }
    expect(await problemOf(await remove(await registerUser("Marta"), h.spaceId, pedro))).toEqual([
      404,
      "SpaceNotFound",
    ]);
  });
});
