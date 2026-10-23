import { describe, expect, it, vi } from "vitest";
import {
  accountDto,
  cop,
  householdSpace,
  memberDto,
  spaceDto,
  transactionDto,
} from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { loadTransactionDetail } from "./detail-loader";

// `loaded` reads headers, and for a 404 it renders the not-found page: the loader must not, so a deleted `tx` can
// say so inside the sheet.
vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() must not be called for a missing transaction");
  },
  redirect: () => {
    throw new Error("redirect");
  },
}));

const tx = transactionDto({ id: "t-1", amount: cop(10_000) });
const members = {
  items: [memberDto({ id: "m-ana", userId: "u-ana" }), memberDto({ id: "m-juan", userId: "u-juan" })],
};

describe("loadTransactionDetail (ruling P189)", () => {
  it("reads the transaction only, in a personal space", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/transactions/{transactionId}": () => jsonResponse(tx),
    });
    const detail = await loadTransactionDetail(api, {
      spaceId: "sp-personal",
      transactionId: "t-1",
      space: spaceDto(),
      meUserId: "u-ana",
      personalSpaceId: "sp-personal",
    });
    expect(detail).toEqual({
      tx,
      problem: null,
      members: [],
      viewer: { userId: "u-ana", role: "OWNER", memberId: null },
      ownAccountNames: {},
    });
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
      "/api/v1/spaces/sp-personal/transactions/t-1",
    ]);
  });

  it("also reads the members of a shared space and finds the viewer's among them", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/transactions/{transactionId}": () => jsonResponse(tx),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse(members),
    });
    const detail = await loadTransactionDetail(api, {
      spaceId: "sp-household",
      transactionId: "t-1",
      space: householdSpace({ role: "MEMBER" }),
      meUserId: "u-juan",
    });
    expect(detail.members).toHaveLength(2);
    expect(detail.viewer).toEqual({ userId: "u-juan", role: "MEMBER", memberId: "m-juan" });
  });

  it("also reads the viewer's personal accounts in a shared space, to name their own (issue #165)", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/transactions/{transactionId}": () => jsonResponse(tx),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse(members),
      "GET /api/v1/spaces/{spaceId}/accounts": () =>
        jsonResponse({
          items: [
            accountDto({ id: "a-ana-bank", name: "Bancolombia" }),
            accountDto({ id: "a-ana-old", name: "Old wallet", archivedAt: "2026-01-01T00:00:00.000Z" }),
          ],
        }),
    });
    const detail = await loadTransactionDetail(api, {
      spaceId: "sp-household",
      transactionId: "t-1",
      space: householdSpace(),
      meUserId: "u-ana",
      personalSpaceId: "sp-personal",
    });
    expect(detail.ownAccountNames).toEqual({ "a-ana-bank": "Bancolombia", "a-ana-old": "Old wallet" });
    const accounts = requests.find((r) => new URL(r.url).pathname.endsWith("/accounts"))!;
    expect(new URL(accounts.url).pathname).toBe("/api/v1/spaces/sp-personal/accounts");
    expect(new URL(accounts.url).searchParams.get("archived")).toBe("true");
  });

  it("still opens the sheet when the personal accounts cannot be read", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/transactions/{transactionId}": () => jsonResponse(tx),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse(members),
      "GET /api/v1/spaces/{spaceId}/accounts": () => problemResponse(500, "InternalError"),
    });
    const detail = await loadTransactionDetail(api, {
      spaceId: "sp-household",
      transactionId: "t-1",
      space: householdSpace(),
      meUserId: "u-ana",
      personalSpaceId: "sp-personal",
    });
    expect(detail.tx).toEqual(tx);
    expect(detail.ownAccountNames).toEqual({});
  });

  it("answers the problem of a missing or deleted transaction instead of the not-found page", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/transactions/{transactionId}": () =>
        problemResponse(404, "TransactionNotFound"),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse(members),
    });
    const detail = await loadTransactionDetail(api, {
      spaceId: "sp-household",
      transactionId: "t-gone",
      space: householdSpace(),
      meUserId: "u-ana",
    });
    expect(detail.tx).toBeNull();
    expect(detail.problem).toMatchObject({ code: "TransactionNotFound", status: 404 });
  });
});
