import { describe, expect, it, vi } from "vitest";
import {
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
    });
    expect(detail).toEqual({
      tx,
      problem: null,
      members: [],
      viewer: { userId: "u-ana", role: "OWNER", memberId: null },
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
