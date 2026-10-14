import { describe, expect, it } from "vitest";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { DirectSplitBodySchema, directSplitFromBody } from "./ledger.contract";

const body = (overrides: Record<string, unknown> = {}) =>
  DirectSplitBodySchema.parse({
    counterpart: { kind: "GUEST", displayName: "Pedro" },
    description: "Dinner",
    date: "2026-10-14",
    categoryKey: "restaurants",
    amount: { amount: "12000000", currency: "COP" },
    accountId: "acc-bancolombia",
    ...overrides,
  });

describe("direct-split bodies (HU-E1-13)", () => {
  it("names a new guest, or a member, and keeps the expense as RecordExpenseByCategoryKey takes it", () => {
    expect(unwrap(directSplitFromBody(body()))).toEqual({
      counterpart: { guest: { displayName: "Pedro", contactEmail: undefined } },
      expense: {
        description: "Dinner",
        date: "2026-10-14",
        amount: money(12_000_000n),
        accountId: "acc-bancolombia",
        categoryKey: "restaurants",
      },
    });
    const member = body({ counterpart: { kind: "MEMBER", memberId: "member-pedro" } });
    expect(unwrap(directSplitFromBody(member)).counterpart).toEqual({ memberId: "member-pedro" });
  });

  it("refuses currencies the kernel does not know", () => {
    const unknown = body({ amount: { amount: "100", currency: "XYZ" } });
    expect(codeOf(directSplitFromBody(unknown))).toBe("UnknownCurrency");
  });

  it("refuses a counterpart of another kind at the edge", () => {
    expect(DirectSplitBodySchema.safeParse({ ...body(), counterpart: { kind: "FRIEND" } }).success).toBe(
      false,
    );
  });
});
