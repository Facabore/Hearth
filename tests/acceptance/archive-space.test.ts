import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { GET as listSpaces } from "@/app/api/v1/spaces/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { addGuest, cop, household, paysEqually, post, settles } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const archive = (user: TestUser, spaceId: string) =>
  call(archiveSpace, "POST", `/api/v1/spaces/${spaceId}/archive`, { user, params: { spaceId } });
const spaceIdsOf = async (user: TestUser, query = ""): Promise<string[]> => {
  const response = await call(listSpaces, "GET", `/api/v1/spaces${query}`, { user });
  return ((await response.json()) as { items: { id: string }[] }).items.map((s) => s.id);
};

describe("archive a space (HU-E1-09)", () => {
  it("archives a space whose members, the guest Pedro included, are settled, and lists it only on request", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    await paysEqually(h.ana, 100_000, [h.ana.memberId, pedro], h.groceries);
    await settles(h.ana, pedro, h.ana.memberId, 50_000);
    expect((await archive(h.ana, h.spaceId)).status).toBe(204);
    const { rows } = await app.pool.query("SELECT archived_at FROM spaces WHERE id = $1", [h.spaceId]);
    expect(rows[0].archived_at).toBeInstanceOf(Date);
    expect(await spaceIdsOf(h.ana)).toEqual([h.ana.personal.spaceId]);
    // The M1 convention: archived=true includes the archived spaces beside the active ones.
    expect((await spaceIdsOf(h.ana, "?archived=true")).sort()).toEqual(
      [h.ana.personal.spaceId, h.spaceId].sort(),
    );
  });

  it("refuses an expense of 50,000 COP in the archived space with SpaceArchived", async () => {
    const h = await household();
    expect((await archive(h.ana, h.spaceId)).status).toBe(204);
    const response = await post(recordExpense, h.ana, "expenses", {
      description: "Snacks",
      date: "2026-10-05",
      categoryId: h.groceries,
      amount: cop(50_000),
      payments: [{ memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(50_000) }],
    });
    expect(await problemOf(response)).toEqual([409, "SpaceArchived"]);
  });

  it("refuses archiving while Juan owes Ana 150,000 COP, stating the amount", async () => {
    const h = await household();
    await paysEqually(h.ana, 300_000, [h.ana.memberId, h.juan.memberId], h.groceries);
    const response = await archive(h.ana, h.spaceId);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "OutstandingBalance", outstanding: cop(150_000) });
  });

  it("refuses archiving while only the guest Pedro owes Ana 100,000 COP (Review Focus 1)", async () => {
    const h = await household();
    const pedro = await addGuest(h, "Pedro");
    await paysEqually(h.ana, 200_000, [h.ana.memberId, pedro], h.groceries);
    expect(await problemOf(await archive(h.ana, h.spaceId))).toEqual([409, "OutstandingBalance"]);
  });

  it("never archives a personal space, lets only the OWNER archive and hides the space from others", async () => {
    const h = await household();
    expect(await problemOf(await archive(h.ana.personal, h.ana.personal.spaceId))).toEqual([
      409,
      "PersonalSpaceNotArchivable",
    ]);
    expect(await problemOf(await archive(h.juan, h.spaceId))).toEqual([403, "InsufficientRole"]);
    expect(await problemOf(await archive(await registerUser("Marta"), h.spaceId))).toEqual([
      404,
      "SpaceNotFound",
    ]);
  });
});
