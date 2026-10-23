import { describe, expect, it, vi } from "vitest";
import {
  accountDto,
  categoryDto,
  cop,
  groupDto,
  guestDto,
  householdSpace,
  meDto,
  memberDto,
  spaceDto,
  transactionDto,
} from "../../../../../tests/support/ui/dto";
import {
  fakeApi,
  jsonResponse,
  problemResponse,
  type FakeHandler,
} from "../../../../../tests/support/ui/fake-api";

const session = vi.hoisted(() => ({ spaces: [] as unknown[] }));
vi.mock("@/shared/ui/api/server", async () => ({
  loaded: async (call: Promise<{ data?: unknown; error?: unknown; response: Response }>) => {
    const { data, error } = await call;
    return error ? { ok: false, problem: { code: "Failed" } } : { ok: true, data };
  },
  getMe: async () => (await import("../../../../../tests/support/ui/dto")).meDto(),
  getSpaces: async () => session.spaces,
  redirectToSignIn: async () => {
    throw new Error("sign in");
  },
}));
const { loadEditContext } = await import("./edit-container");

const TX = "/api/v1/spaces/{spaceId}/transactions/{transactionId}";
const expense = transactionDto({
  id: "t-1",
  type: "EXPENSE",
  amount: cop(85_000),
  categoryId: "c-old",
  payments: [{ memberId: "m-ana", accountId: "a-old", amount: cop(85_000) }],
  shares: [{ memberId: "m-ana", amount: cop(85_000), splitMethod: "EQUAL" }],
});
const groups = [
  groupDto({
    id: "g-1",
    categories: [categoryDto({ id: "c-old", archivedAt: "2026-09-01T00:00:00.000Z" })],
  }),
];
const read = (routes: Record<string, FakeHandler>) =>
  fakeApi({
    [`GET ${TX}`]: () => jsonResponse(expense),
    "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: groups }),
    ...routes,
  });
const input = { spaceId: "sp-personal", transactionId: "t-1" };

describe("loadEditContext (ruling P191)", () => {
  it("reads the transaction, every account and every category of a personal space, once each", async () => {
    session.spaces = [spaceDto()];
    const { api, requests } = read({
      "GET /api/v1/spaces/{spaceId}/accounts": () =>
        jsonResponse({
          items: [
            accountDto({ id: "a-bank" }),
            accountDto({ id: "a-old", archivedAt: "2026-09-01T00:00:00.000Z" }),
            accountDto({ id: "a-closed", archivedAt: "2026-08-01T00:00:00.000Z" }),
          ],
        }),
    });
    const result = await loadEditContext(api, input);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data) throw new Error("expected a context");
    // The archived account the record was made with still names itself; one it never used is not offered.
    expect(result.data.accounts.map((a) => a.id)).toEqual(["a-bank", "a-old"]);
    expect(result.data.groups).toEqual(groups);
    expect(result.data.tx).toEqual(expense);
    expect(result.data.space.id).toBe("sp-personal");
    expect(result.data.me.id).toBe(meDto().id);
    expect(result.data.shared).toBeUndefined();
    expect(result.data.actions.edit).toBe(true);
    expect(
      requests.map((r) => `${r.method} ${new URL(r.url).pathname}${new URL(r.url).search}`).sort(),
    ).toEqual([
      "GET /api/v1/spaces/sp-personal/accounts?archived=true",
      "GET /api/v1/spaces/sp-personal/categories?archived=true",
      "GET /api/v1/spaces/sp-personal/transactions/t-1",
    ]);
  });

  it("keeps the accounts of a transfer even when they are archived", async () => {
    session.spaces = [spaceDto()];
    const transfer = transactionDto({
      id: "t-1",
      type: "TRANSFER",
      sourceAccountId: "a-src",
      destinationAccountId: "a-dst",
    });
    const { api } = read({
      [`GET ${TX}`]: () => jsonResponse(transfer),
      "GET /api/v1/spaces/{spaceId}/accounts": () =>
        jsonResponse({
          items: [
            accountDto({ id: "a-src", archivedAt: "2026-09-01T00:00:00.000Z" }),
            accountDto({ id: "a-dst", archivedAt: "2026-09-01T00:00:00.000Z" }),
            accountDto({ id: "a-other", archivedAt: "2026-09-01T00:00:00.000Z" }),
          ],
        }),
    });
    const result = await loadEditContext(api, input);
    expect(result.ok && result.data?.accounts.map((a) => a.id)).toEqual(["a-src", "a-dst"]);
  });

  it("adds the members and the recorder's own accounts in a shared space, and says who may edit", async () => {
    session.spaces = [spaceDto(), householdSpace({ role: "MEMBER" })];
    const members = [
      memberDto({ id: "m-ana", userId: "u-ana", role: "MEMBER" }),
      memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan" }),
    ];
    const byJuan = {
      ...expense,
      createdBy: "u-juan",
      payments: [{ ...expense.payments[0]!, memberId: "m-juan" }],
    };
    const { api } = read({
      [`GET ${TX}`]: () => jsonResponse(byJuan),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: members }),
      // The shared space's accounts (with the archived ones), then Ana's personal ones.
      "GET /api/v1/spaces/{spaceId}/accounts": (_request, params) =>
        jsonResponse({
          items: [accountDto({ id: params.spaceId === "sp-household" ? "a-fund" : "a-bank" })],
        }),
    });
    const result = await loadEditContext(api, { spaceId: "sp-household", transactionId: "t-1" });
    if (!result.ok || !result.data) throw new Error("expected a context");
    expect(result.data.shared?.meMemberId).toBe("m-ana");
    expect(result.data.shared?.members.map((m) => m.id)).toEqual(["m-ana", "m-juan"]);
    // A MEMBER does not edit someone else's expense; the route sends them back to the sheet.
    expect(result.data.actions).toMatchObject({ edit: false, delete: false });
  });

  it("answers nothing for a missing or deleted transaction", async () => {
    session.spaces = [spaceDto()];
    const { api } = read({
      [`GET ${TX}`]: () => problemResponse(404, "TransactionNotFound"),
      "GET /api/v1/spaces/{spaceId}/accounts": () => jsonResponse({ items: [] }),
    });
    expect(await loadEditContext(api, input)).toEqual({ ok: true, data: null });
  });

  it("answers nothing for a space the person is not in, or one they are no longer a member of", async () => {
    session.spaces = [spaceDto()];
    const { api } = read({ "GET /api/v1/spaces/{spaceId}/accounts": () => jsonResponse({ items: [] }) });
    expect(await loadEditContext(api, { spaceId: "sp-elsewhere", transactionId: "t-1" })).toEqual({
      ok: true,
      data: null,
    });

    session.spaces = [spaceDto(), householdSpace()];
    const left = read({
      "GET /api/v1/spaces/{spaceId}/members": () =>
        jsonResponse({ items: [guestDto(), memberDto({ userId: "u-x" })] }),
      "GET /api/v1/spaces/{spaceId}/accounts": () => jsonResponse({ items: [] }),
    });
    expect(await loadEditContext(left.api, { spaceId: "sp-household", transactionId: "t-1" })).toEqual({
      ok: true,
      data: null,
    });
  });

  it("passes on the problem of a failed read", async () => {
    session.spaces = [spaceDto()];
    const { api } = read({
      "GET /api/v1/spaces/{spaceId}/accounts": () => problemResponse(403, "Forbidden"),
    });
    expect(await loadEditContext(api, input)).toMatchObject({ ok: false });
  });

  it("goes to the sign-in screen when the session ended", async () => {
    session.spaces = [spaceDto()];
    const { api } = read({
      [`GET ${TX}`]: () => problemResponse(401, "Unauthenticated"),
      "GET /api/v1/spaces/{spaceId}/accounts": () => jsonResponse({ items: [] }),
    });
    await expect(loadEditContext(api, input)).rejects.toThrow("sign in");
  });
});
