import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getMyAccounts } from "@/app/api/v1/me/accounts/route";
import { GET as getMyCategories } from "@/app/api/v1/me/categories/route";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, startTestApp, type TestUser } from "../support/app";
import { household } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface MyCategoriesDto {
  items: { spaceId: string; groups: { id: string; key: string | null; categories: { id: string }[] }[] }[];
}
interface MyAccountsDto {
  items: { spaceId: string; accounts: { id: string; name: string; balance: { amount: string } }[] }[];
}

const read = async <T>(handler: typeof getMyCategories, path: string, user: TestUser): Promise<T> => {
  const response = await call(handler, "GET", path, { user });
  expect(response.status).toBe(200);
  return (await response.json()) as T;
};

describe("GET /api/v1/me/categories and /api/v1/me/accounts (#338)", () => {
  it("gives Ana each of her spaces, personal included, with its categories and its accounts", async () => {
    const h = await household();
    const categories = await read<MyCategoriesDto>(getMyCategories, "/api/v1/me/categories", h.ana);
    expect(categories.items.map((entry) => entry.spaceId).sort()).toEqual(
      [h.ana.personal.spaceId, h.spaceId].sort(),
    );
    const householdTree = categories.items.find((entry) => entry.spaceId === h.spaceId)!.groups;
    expect(householdTree.flatMap((g) => g.categories.map((c) => c.id))).toContain(h.groceries);

    const accounts = await read<MyAccountsDto>(getMyAccounts, "/api/v1/me/accounts", h.ana);
    const personal = accounts.items.find((entry) => entry.spaceId === h.ana.personal.spaceId)!.accounts;
    expect(personal.find((a) => a.id === h.ana.account)).toMatchObject({
      name: "Bancolombia",
      balance: { amount: "200000000" },
    });
    expect(accounts.items.map((entry) => entry.spaceId)).toContain(h.spaceId);
  });

  it("lists an archived account only with archived=true, and leaves out an archived space", async () => {
    const h = await household();
    const spaceId = h.ana.personal.spaceId;
    const archived = await call(
      archiveAccount,
      "POST",
      `/api/v1/spaces/${spaceId}/accounts/${h.ana.account}/archive`,
      {
        user: h.ana.personal,
        params: { spaceId, accountId: h.ana.account },
      },
    );
    expect(archived.status).toBe(200);
    const personalIds = async (path: string) =>
      (await read<MyAccountsDto>(getMyAccounts, path, h.ana)).items
        .find((entry) => entry.spaceId === spaceId)!
        .accounts.map((a) => a.id);
    expect(await personalIds("/api/v1/me/accounts")).not.toContain(h.ana.account);
    expect(await personalIds("/api/v1/me/accounts?archived=true")).toContain(h.ana.account);

    const gone = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    expect(gone.status).toBe(204);
    const left = await read<MyCategoriesDto>(getMyCategories, "/api/v1/me/categories", h.ana);
    expect(left.items.map((entry) => entry.spaceId)).toEqual([spaceId]);
  });

  it("answers 401 without a session", async () => {
    expect((await call(getMyCategories, "GET", "/api/v1/me/categories", {})).status).toBe(401);
    expect((await call(getMyAccounts, "GET", "/api/v1/me/accounts", {})).status).toBe(401);
  });
});
