import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntlWrapper } from "../../../../tests/support/ui/render";
import { useProblemMessage } from "./use-problem-message";

const problem = (code: string, requestId: string | null = "req-9") => ({
  code,
  status: 403,
  requestId,
  errors: [],
  field: null,
});

describe("useProblemMessage (HU-E9-02)", () => {
  it("translates a known code in the user's language", () => {
    const { result } = renderHook(() => useProblemMessage(), { wrapper: IntlWrapper("es") });
    expect(result.current(problem("InsufficientRole"))).toEqual({
      message: "No tienes permiso para hacer esto en este espacio.",
      reference: null,
    });
  });

  it("fills the period a problem names into its message (ruling P248)", () => {
    const es = renderHook(() => useProblemMessage(), { wrapper: IntlWrapper("es") }).result.current;
    expect(es({ ...problem("SourcePlanOpen"), status: 409, sourcePeriod: "2026-11" }).message).toBe(
      "Primero cierra el plan de 2026-11: este plan arrastra saldo de ese mes.",
    );
  });

  it("shows errors.Unknown with the request id for a code without a key", () => {
    const es = renderHook(() => useProblemMessage(), { wrapper: IntlWrapper("es") }).result.current;
    expect(es(problem("NoSuchCode"))).toEqual({
      message: "Algo salió mal. Intenta de nuevo.",
      reference: "Referencia: req-9",
    });
    const en = renderHook(() => useProblemMessage(), { wrapper: IntlWrapper("en") }).result.current;
    expect(en(problem("NoSuchCode", null))).toEqual({
      message: "Something went wrong. Please try again.",
      reference: null,
    });
  });
});
