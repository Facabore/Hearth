import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountDto,
  cop,
  householdSpace,
  memberDto,
  meDto,
  octoberPage,
  rowContext,
  spaceDto,
} from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { HomeContainer } from "./home-container";

const mocks = vi.hoisted(() => ({ getMe: vi.fn(), getSpaces: vi.fn(), serverApi: vi.fn() }));
vi.mock("next/headers", () => ({}));
vi.mock("@/shared/ui/api/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/ui/api/server")>()),
  getMe: mocks.getMe,
  getSpaces: mocks.getSpaces,
  serverApi: mocks.serverApi,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getMe.mockResolvedValue(meDto());
});

const routes = {
  "GET /api/v1/spaces/{spaceId}/transactions": () => jsonResponse(octoberPage),
  "GET /api/v1/spaces/{spaceId}/accounts": () =>
    jsonResponse({ items: [accountDto()], totals: { available: cop(0), netWorth: cop(0) } }),
  "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: rowContext.groups }),
  "GET /api/v1/spaces/{spaceId}/members": () =>
    jsonResponse({
      items: [memberDto(), memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan" })],
    }),
};
const propsOf = (element: unknown) => (element as { props: Record<string, unknown> }).props;
const paths = (requests: Request[]) => requests.map((r) => new URL(r.url).pathname);

describe("the home container and the detail sheet (ruling P189)", () => {
  it("reads the transaction behind ?tx= and the members of a shared space, and only then", async () => {
    mocks.getSpaces.mockResolvedValue([householdSpace()]);
    const withTx = fakeApi({
      ...routes,
      "GET /api/v1/spaces/{spaceId}/transactions/{transactionId}": () => jsonResponse(octoberPage.items[1]),
    });
    mocks.serverApi.mockResolvedValue(withTx.api);
    const element = await HomeContainer({ spaceId: "sp-household", transactionId: "t-dinner" });
    expect(propsOf(element)).toMatchObject({
      detail: {
        tx: { id: "t-dinner" },
        problem: null,
        viewer: { userId: "u-ana", role: "OWNER", memberId: "m-ana" },
      },
    });
    expect(paths(withTx.requests)).toContain("/api/v1/spaces/sp-household/transactions/t-dinner");

    const without = fakeApi(routes);
    mocks.serverApi.mockResolvedValue(without.api);
    expect(propsOf(await HomeContainer({ spaceId: "sp-household" })).detail).toBeUndefined();
    expect(paths(without.requests).join()).not.toContain("t-dinner");
  });

  it("passes the problem of a ?tx= that is gone", async () => {
    mocks.getSpaces.mockResolvedValue([spaceDto()]);
    mocks.serverApi.mockResolvedValue(
      fakeApi({
        ...routes,
        "GET /api/v1/spaces/{spaceId}/transactions/{transactionId}": () =>
          problemResponse(404, "TransactionNotFound"),
      }).api,
    );
    const element = await HomeContainer({ spaceId: "sp-personal", transactionId: "t-gone" });
    expect(propsOf(element)).toMatchObject({
      detail: { tx: null, problem: { code: "TransactionNotFound" } },
    });
  });
});
