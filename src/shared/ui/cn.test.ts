import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins classes, drops falsy ones and lets the later Tailwind utility win", () => {
    const hidden: boolean = false;
    expect(cn("p-2 text-ink", hidden && "hidden", undefined, "p-4")).toBe("text-ink p-4");
  });
});
