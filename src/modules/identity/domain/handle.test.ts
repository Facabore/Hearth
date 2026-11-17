import { describe, expect, it } from "vitest";
import { parseHandle } from "./handle";

describe("parseHandle (P339)", () => {
  it("keeps 3 to 20 lower-case letters, digits and underscores", () => {
    expect(parseHandle("ana")).toEqual({ ok: true, value: "ana" });
    expect(parseHandle("fabian_2026")).toEqual({ ok: true, value: "fabian_2026" });
    expect(parseHandle("a".repeat(20))).toEqual({ ok: true, value: "a".repeat(20) });
  });

  it("reads upper case as lower case and drops spaces around it and one leading @", () => {
    expect(parseHandle("  @Fabian_B  ")).toEqual({ ok: true, value: "fabian_b" });
  });

  it("refuses anything shorter, longer or outside the set", () => {
    for (const raw of ["", "ab", "@ab", "a".repeat(21), "ana-maria", "ana maria", "añá", "@@ana", "ana.b"]) {
      expect(parseHandle(raw)).toMatchObject({ ok: false, error: { code: "InvalidHandle" } });
    }
  });
});
