import { describe, expect, it } from "vitest";
import { withoutTx, withTx } from "./tx-href";

describe("the detail sheet's address (ruling P189)", () => {
  it.each([
    ["/spaces/s-1/transactions", "t-9", "/spaces/s-1/transactions?tx=t-9"],
    [
      "/spaces/s-1/transactions?period=2026-10&category=c-1",
      "t-9",
      "/spaces/s-1/transactions?period=2026-10&category=c-1&tx=t-9",
    ],
    ["/spaces/s-1?tx=t-1", "t-9", "/spaces/s-1?tx=t-9"],
  ])("withTx(%s, %s) is %s", (href, id, expected) => expect(withTx(href, id)).toBe(expected));

  it.each([
    ["/spaces/s-1/transactions?period=2026-10&tx=t-9", "/spaces/s-1/transactions?period=2026-10"],
    ["/spaces/s-1?tx=t-9", "/spaces/s-1"],
    ["/spaces/s-1", "/spaces/s-1"],
  ])("withoutTx(%s) is %s", (href, expected) => expect(withoutTx(href)).toBe(expected));
});
