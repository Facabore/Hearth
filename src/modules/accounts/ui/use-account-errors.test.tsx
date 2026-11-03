import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlWrapper } from "../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { useAccountErrors, type Where } from "./use-account-errors";

/** The error the forms show under `field` once its text could not be read, in the built-in es-CO formats. */
const unreadableError = (field: Where) => {
  const { result } = renderHook(() => useAccountErrors(BUILT_IN_FORMATS), { wrapper: IntlWrapper("es") });
  act(() => result.current.setUnreadable(field));
  return result.current.errorOf(field);
};

describe("useAccountErrors: a number it cannot read (#194)", () => {
  it("gives an amount an amount as the example", () => {
    for (const field of ["opening", "creditLimit", "principal"] as const) {
      expect([field, unreadableError(field)]).toEqual([field, "Escribe un monto como 1.500.000."]);
    }
  });

  it("gives each rate, day and term its own example", () => {
    expect(
      (["monthlyRate", "annualRate", "cutOffDay", "paymentDay", "termDays", "termMonths"] as const).map(
        (field) => [field, unreadableError(field)],
      ),
    ).toEqual([
      ["monthlyRate", "Escribe un número como 1,89."],
      ["annualRate", "Escribe un número como 12,5."],
      ["cutOffDay", "Escribe un número como 25."],
      ["paymentDay", "Escribe un número como 15."],
      ["termDays", "Escribe un número como 90."],
      ["termMonths", "Escribe un número como 36."],
    ]);
  });

  it("falls back to 1,5 for a field with no example of its own", () => {
    expect(unreadableError("institution")).toBe("Escribe un número como 1,5.");
  });

  it("shows the error under that field only, and drops it once the field changes", () => {
    const { result } = renderHook(() => useAccountErrors(BUILT_IN_FORMATS), { wrapper: IntlWrapper("es") });
    act(() => result.current.setUnreadable("cutOffDay"));
    expect(result.current.errorOf("paymentDay")).toBeUndefined();
    act(() => result.current.clear("paymentDay"));
    expect(result.current.errorOf("cutOffDay")).toBe("Escribe un número como 25.");
    act(() => result.current.clear("cutOffDay"));
    expect(result.current.errorOf("cutOffDay")).toBeUndefined();
  });
});
