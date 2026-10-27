import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  householdSpace,
  memberDto,
  meDto,
  octoberPage,
  rowContext,
  spaceDto,
} from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, type FakeHandler } from "../../../../tests/support/ui/fake-api";
import type { MeDto, SpaceDto } from "@/shared/ui/api/dto";
import { TransactionListContainer } from "./transaction-list-container";

const mocks = vi.hoisted(() => ({ getMe: vi.fn(), getSpaces: vi.fn(), serverApi: vi.fn() }));
vi.mock("next/headers", () => ({}));
vi.mock("@/shared/ui/api/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/ui/api/server")>()),
  getMe: mocks.getMe,
  getSpaces: mocks.getSpaces,
  serverApi: mocks.serverApi,
}));
beforeEach(() => vi.clearAllMocks());

/** A promise the test settles by hand, so it decides when each read answers. */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};

/** A route that answers only once the test releases it: the calls in flight together are the ones it has seen. */
const held = (respond: FakeHandler) => {
  const gate = deferred<void>();
  const handler: FakeHandler = async (request, params) => {
    await gate.promise;
    return respond(request, params);
  };
  return { handler, release: () => gate.resolve() };
};

const september = { label: "2026-09", startDate: "2026-09-01", endDate: "2026-09-30" };
const november = { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" };
const members = [memberDto(), memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan" })];

describe("the list container's reads (issue #196, no serial rounds)", () => {
  it("starts every independent read at once, and each dependent one as soon as its own input arrives", async () => {
    const me = deferred<MeDto>();
    const spaces = deferred<SpaceDto[]>();
    mocks.getMe.mockReturnValue(me.promise);
    mocks.getSpaces.mockReturnValue(spaces.promise);
    const list = held(() => jsonResponse(octoberPage));
    const rest = held((request, params) => {
      const { pathname, searchParams } = new URL(request.url);
      if (pathname.endsWith("/categories")) return jsonResponse({ items: rowContext.groups });
      if (pathname.endsWith("/members")) return jsonResponse({ items: members });
      if (pathname.endsWith("/periods"))
        return jsonResponse({ items: [searchParams.get("from") === "2026-09-30" ? september : november] });
      if (params.transactionId) return jsonResponse(octoberPage.items[1]);
      return jsonResponse({ items: [] });
    });
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/transactions": list.handler,
      "GET /api/v1/spaces/{spaceId}/transactions/{transactionId}": rest.handler,
      "GET /api/v1/spaces/{spaceId}/categories": rest.handler,
      "GET /api/v1/spaces/{spaceId}/accounts": rest.handler,
      "GET /api/v1/spaces/{spaceId}/members": rest.handler,
      "GET /api/v1/spaces/{spaceId}/periods": rest.handler,
    });
    mocks.serverApi.mockResolvedValue(api);
    const inFlight = () =>
      requests.map(
        (r) => `${new URL(r.url).pathname}${new URL(r.url).search.includes("from=") ? "?from" : ""}`,
      );

    const element = TransactionListContainer({
      spaceId: "sp-household",
      period: "2026-10",
      transactionId: "t-dinner",
    });

    // Before the person and their spaces answer: the page and every name it needs are already asked for.
    await vi.waitFor(() =>
      expect(inFlight().sort()).toEqual([
        "/api/v1/spaces/sp-household/accounts",
        "/api/v1/spaces/sp-household/categories",
        "/api/v1/spaces/sp-household/transactions",
      ]),
    );

    // The spaces name the space shared: its members and the detail start while the list is still unanswered.
    me.resolve(meDto());
    spaces.resolve([spaceDto(), householdSpace()]);
    await vi.waitFor(() => expect(requests).toHaveLength(7));
    expect(inFlight().slice(3).sort()).toEqual([
      "/api/v1/spaces/sp-household/members",
      "/api/v1/spaces/sp-household/members",
      "/api/v1/spaces/sp-household/transactions/t-dinner",
      "/api/v1/spaces/sp-personal/accounts",
    ]);

    // The page alone names its period: the neighbours start before the categories, accounts or members answer.
    list.release();
    await vi.waitFor(() =>
      expect(inFlight().filter((path) => path.endsWith("?from"))).toEqual([
        "/api/v1/spaces/sp-household/periods?from",
        "/api/v1/spaces/sp-household/periods?from",
      ]),
    );

    rest.release();
    const props = ((await element) as unknown as { props: Record<string, unknown> }).props;
    expect(props).toMatchObject({
      spaceId: "sp-household",
      spaceName: "Household",
      previous: september,
      next: november,
      detail: { tx: { id: "t-dinner" }, problem: null, viewer: { memberId: "m-ana" } },
      context: { memberNames: { "m-ana": "Ana", "m-juan": "Juan" } },
    });
    expect(requests).toHaveLength(9);
  });
});
