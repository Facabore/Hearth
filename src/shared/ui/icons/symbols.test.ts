import { describe, expect, it } from "vitest";
import { SYMBOLS } from "@/shared/kernel/style";
import { SYMBOL_PATHS } from "./symbols";

describe("the symbol registry (ruling P122)", () => {
  it("draws every symbol name the API accepts, and only those", () => {
    expect(Object.keys(SYMBOL_PATHS).sort()).toEqual([...SYMBOLS]);
    for (const path of Object.values(SYMBOL_PATHS)) expect(path).toMatch(/^[Mm]\d/);
  });
});
