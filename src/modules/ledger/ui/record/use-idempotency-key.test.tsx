import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useIdempotencyKey } from "./use-idempotency-key";

describe("useIdempotencyKey (HU-E0-10, ruling P128)", () => {
  it("keeps one key per unchanged draft and renews it when the draft changes or after a save", () => {
    const { result, rerender } = renderHook(({ signature }) => useIdempotencyKey(signature), {
      initialProps: { signature: "a" },
    });
    const first = result.current.key;
    rerender({ signature: "a" });
    expect(result.current.key).toBe(first);
    rerender({ signature: "b" });
    const second = result.current.key;
    expect(second).not.toBe(first);
    act(() => result.current.renew());
    expect(result.current.key).not.toBe(second);
    expect(result.current.key).toMatch(/^[0-9a-f-]{36}$/);
  });
});
