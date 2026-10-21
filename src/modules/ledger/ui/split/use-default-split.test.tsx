import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { cop } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { useDefaultSplit } from "./use-default-split";

const answer = (amount: string) =>
  jsonResponse({
    method: "BY_ALLOCATION",
    availableMethods: ["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"],
    lineId: "l-home",
    shares: [
      { memberId: "m-ana", amount: { amount: String((BigInt(amount) * 2n) / 5n), currency: "COP" } },
      { memberId: "m-juan", amount: { amount: String((BigInt(amount) * 3n) / 5n), currency: "COP" } },
    ],
  });

const input = (api: ReturnType<typeof fakeApi>["api"], amount: string | null, over = {}) => ({
  api,
  spaceId: "sp-household",
  categoryId: "c-groceries" as string | null,
  date: "2026-11-08",
  amount,
  enabled: true,
  ...over,
});

describe("useDefaultSplit (HU-E6-08, ruling P167)", () => {
  it("asks once the inputs settle, with the category, the date and the amount", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (r) => answer(new URL(r.url).searchParams.get("amount")!),
    });
    const { result, rerender } = renderHook(
      (props: { amount: string }) => useDefaultSplit(input(api, props.amount)),
      { initialProps: { amount: "100000000" } },
    );
    rerender({ amount: "200000000" });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(requests).toHaveLength(1);
    expect(Object.fromEntries(new URL(requests[0]!.url).searchParams)).toEqual({
      categoryId: "c-groceries",
      date: "2026-11-08",
      amount: "200000000",
    });
    expect(result.current).toMatchObject({
      method: "BY_ALLOCATION",
      shares: [
        { memberId: "m-ana", amount: cop(800_000).amount },
        { memberId: "m-juan", amount: cop(1_200_000).amount },
      ],
    });
  });

  it("never lets an older answer replace a newer one", async () => {
    let release: () => void = () => undefined;
    const slow = new Promise<void>((resolve) => (release = resolve));
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": async (r) => {
        const amount = new URL(r.url).searchParams.get("amount")!;
        if (amount === "100000000") await slow;
        return answer(amount);
      },
    });
    const { result, rerender } = renderHook(
      (props: { amount: string }) => useDefaultSplit(input(api, props.amount)),
      { initialProps: { amount: "100000000" } },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    rerender({ amount: "200000000" });
    await waitFor(() => expect(result.current).toMatchObject({ key: "c-groceries|2026-11-08|200000000" }));
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current).toMatchObject({ key: "c-groceries|2026-11-08|200000000" });
  });

  it("waits for the inputs to settle before asking, and answers none once disabled", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": () => answer("100000000"),
    });
    const { result, rerender } = renderHook(
      (props: { enabled: boolean }) => useDefaultSplit(input(api, "100000000", props)),
      { initialProps: { enabled: true } },
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(requests).toHaveLength(0);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    rerender({ enabled: false });
    expect(result.current).toEqual({ status: "none" });
  });

  it("ignores a failure of an older request after a newer one answered", async () => {
    let fail: () => void = () => undefined;
    const late = new Promise<void>((_, reject) => (fail = () => reject(new TypeError("offline"))));
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": async (r) => {
        const amount = new URL(r.url).searchParams.get("amount")!;
        if (amount === "100000000") await late;
        return answer(amount);
      },
    });
    const { result, rerender } = renderHook(
      (props: { amount: string }) => useDefaultSplit(input(api, props.amount)),
      { initialProps: { amount: "100000000" } },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    rerender({ amount: "200000000" });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    fail();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(result.current.status).toBe("ready");
  });

  it("asks nothing without a category or when disabled, and answers none", async () => {
    const { api, requests } = fakeApi({});
    const noCategory = renderHook(() => useDefaultSplit(input(api, "100", { categoryId: null })));
    const disabled = renderHook(() => useDefaultSplit(input(api, "100", { enabled: false })));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect([noCategory.result.current.status, disabled.result.current.status, requests.length]).toEqual([
      "none",
      "none",
      0,
    ]);
  });

  it("leaves the amount out of the request while there is none", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": () => answer("0"),
    });
    const { result } = renderHook(() => useDefaultSplit(input(api, null)));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(Object.fromEntries(new URL(requests[0]!.url).searchParams)).toEqual({
      categoryId: "c-groceries",
      date: "2026-11-08",
    });
  });

  it("answers none when the read fails or the network rejects", async () => {
    const failing = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": () => problemResponse(500, "Internal"),
    });
    const first = renderHook(() => useDefaultSplit(input(failing.api, "100")));
    await waitFor(() => expect(failing.requests).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(first.result.current).toEqual({ status: "none" });
    const offline = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": () => Promise.reject(new TypeError("offline")),
    });
    const second = renderHook(() => useDefaultSplit(input(offline.api, "100")));
    await waitFor(() => expect(offline.requests).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(second.result.current).toEqual({ status: "none" });
  });
});
