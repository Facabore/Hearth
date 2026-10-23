import { describe, expect, it } from "vitest";
import { EqualSplitSchema, MAX_PARTS, PercentSplitSchema, SharesSplitSchema, splitOf } from "./split-body";

const member = (n: number) => ({ memberId: `member-${n}` });

describe("the split bodies an expense and a recurrence share", () => {
  it("maps EQUAL to its members, PERCENT to basis points and SHARES to its units", () => {
    expect(splitOf({ method: "EQUAL", participants: [member(1), member(2)] })).toEqual({
      method: "EQUAL",
      participants: [member(1), member(2)],
    });
    expect(
      splitOf({
        method: "PERCENT",
        participants: [
          { ...member(1), percent: "33.33" },
          { ...member(2), percent: "66.67" },
        ],
      }),
    ).toEqual({
      method: "PERCENT",
      participants: [
        { ...member(1), basisPoints: 3333 },
        { ...member(2), basisPoints: 6667 },
      ],
    });
    expect(
      splitOf({
        method: "SHARES",
        participants: [
          { ...member(1), units: 1 },
          { ...member(2), units: 3 },
        ],
      }),
    ).toEqual({
      method: "SHARES",
      participants: [
        { ...member(1), units: 1 },
        { ...member(2), units: 3 },
      ],
    });
  });

  it("drops what the body carries beyond what a method names", () => {
    const parsed = EqualSplitSchema.parse({
      method: "EQUAL",
      participants: [{ ...member(1), percent: "50" }],
    });
    expect(splitOf(parsed)).toEqual({ method: "EQUAL", participants: [member(1)] });
  });

  it(`takes at most ${MAX_PARTS} participants per method`, () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ ...member(i), units: 1, percent: "1" }));
    for (const [schema, method] of [
      [EqualSplitSchema, "EQUAL"],
      [PercentSplitSchema, "PERCENT"],
      [SharesSplitSchema, "SHARES"],
    ] as const) {
      expect(schema.safeParse({ method, participants: many(MAX_PARTS) }).success).toBe(true);
      expect(schema.safeParse({ method, participants: many(MAX_PARTS + 1) }).success).toBe(false);
    }
  });
});
