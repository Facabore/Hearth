import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins classes and drops falsy ones; it leaves conflicting utilities to the caller", () => {
    const hidden: boolean = false;
    expect(cn("p-2 text-ink", hidden && "hidden", undefined, ["p-4"], { "font-bold": true })).toBe(
      "p-2 text-ink p-4 font-bold",
    );
  });
});
