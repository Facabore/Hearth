import { describe, expect, it } from "vitest";
import { domainError } from "./domain-error";
import { err, flatMap, isErr, isOk, map, ok, type Result } from "./result";

const failingUseCase = (): Result<number> => err(domainError("NotASpaceMember", { memberId: "m-1" }));

describe("Result", () => {
  it("carries a typed domain error without throwing", () => {
    expect(() => failingUseCase()).not.toThrow();
    const result = failingUseCase();
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe("NotASpaceMember");
  });

  it("maps only successful values", () => {
    expect(map(ok(2), (n) => n * 10)).toEqual(ok(20));
    const failure = err(domainError("X"));
    expect(map(failure, (n: number) => n * 10)).toBe(failure);
  });

  it("chains with flatMap and short-circuits on the first error", () => {
    const half = (n: number): Result<number> => (n % 2 === 0 ? ok(n / 2) : err(domainError("Odd")));
    expect(flatMap(ok(8), half)).toEqual(ok(4));
    const chained = flatMap(flatMap(ok(6), half), half);
    expect(isErr(chained) && chained.error.code).toBe("Odd");
    expect(isOk(ok(1))).toBe(true);
  });

  it("omits details when none are given", () => {
    expect(domainError("Plain")).toEqual({ code: "Plain" });
  });
});
