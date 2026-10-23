import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { parseDecimal } from "@/shared/ui/format/amount-input";
import type { NumberFormat } from "@/shared/ui/format/formatters";
import { AmountField } from "./amount-field";

/** The field as the form uses it: the typed text lives in the parent. */
function Harness({
  numberFormat = "DOT_COMMA",
  exponent = 2,
  initial = "",
  onValue,
}: {
  numberFormat?: NumberFormat;
  exponent?: number;
  initial?: string;
  onValue?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <AmountField
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
      symbol="$"
      numberFormat={numberFormat}
      exponent={exponent}
    />
  );
}
const field = () => screen.getByLabelText("Monto") as HTMLInputElement;

describe("amount field groups the digits while typing (U3)", () => {
  it("shows 6.000 for 6000 in the person's number format, and parses to the digits typed", async () => {
    const values: string[] = [];
    const { container } = renderWithIntl(<Harness onValue={(v) => values.push(v)} />);
    await userEvent.type(field(), "6000");
    expect(field().value).toBe("6.000");
    expect(values).toEqual(["6", "60", "600", "6.000"]);
    expect(parseDecimal(field().value, "DOT_COMMA")).toBe("6000");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("follows the format: commas for COMMA_DOT, a space for SPACE_COMMA", async () => {
    const { unmount } = renderWithIntl(<Harness numberFormat="COMMA_DOT" />);
    await userEvent.type(field(), "1234567");
    expect(field().value).toBe("1,234,567");
    unmount();
    renderWithIntl(<Harness numberFormat="SPACE_COMMA" />);
    await userEvent.type(field(), "1234567,5");
    expect(field().value).toBe("1\u00a0234\u00a0567,5");
  });

  it("keeps the caret after the digit that was typed in the middle of a number", async () => {
    renderWithIntl(<Harness initial="6.000" />);
    // "6.0|00" → the person types 1 → "6.01|00" → regrouped "60.100", the caret still after the 1.
    await userEvent.type(field(), "1", { initialSelectionStart: 3, initialSelectionEnd: 3 });
    expect(field().value).toBe("60.100");
    expect(field().selectionStart).toBe(4);
    expect(field().selectionEnd).toBe(4);
  });

  it("regroups after a digit is deleted, with the caret where it was", async () => {
    renderWithIntl(<Harness initial="60.100" />);
    await userEvent.type(field(), "{Backspace}", { initialSelectionStart: 4, initialSelectionEnd: 4 });
    expect(field().value).toBe("6.000");
    expect(field().selectionStart).toBe(3);
  });

  it("groups what the keypad types, and the backspace key regroups", async () => {
    renderWithIntl(<Harness />);
    for (const key of ["6", "000"]) await userEvent.click(screen.getByRole("button", { name: key }));
    expect(field().value).toBe("6.000");
    await userEvent.click(screen.getByRole("button", { name: "Borrar" }));
    expect(field().value).toBe("600");
  });

  it("leaves a point typed in a currency without decimals alone, so the amount is reported unreadable", async () => {
    renderWithIntl(<Harness exponent={0} />);
    await userEvent.type(field(), "6,5");
    expect(field().value).toBe("6,5");
  });

  it("says how to type an amount before anything is typed, in the person's format (#164)", () => {
    const { unmount } = renderWithIntl(<Harness />);
    expect(field()).toHaveAccessibleDescription("Ej: 1.250,50");
    unmount();
    renderWithIntl(<Harness numberFormat="COMMA_DOT" />, { locale: "en" });
    expect(screen.getByLabelText("Amount")).toHaveAccessibleDescription("e.g. 1,250.50");
  });

  it("ignores letters", async () => {
    const onValue = vi.fn();
    renderWithIntl(<Harness onValue={onValue} />);
    await userEvent.type(field(), "ab");
    expect(onValue).toHaveBeenLastCalledWith("");
    expect(field().value).toBe("");
  });
});
