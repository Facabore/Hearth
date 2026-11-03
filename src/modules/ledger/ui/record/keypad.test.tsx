import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import type { NumberFormat } from "@/shared/ui/format/formatters";
import { AmountField } from "./amount-field";
import { Keypad } from "./keypad";

/** The amount and the keypad as the form puts them: one typed text, in the parent. */
function Harness({ numberFormat, point }: { numberFormat: NumberFormat; point: boolean }) {
  const exponent = 2;
  const [value, setValue] = useState("");
  return (
    <>
      <AmountField
        value={value}
        onChange={setValue}
        symbol="$"
        numberFormat={numberFormat}
        exponent={exponent}
      />
      <Keypad
        value={value}
        onChange={setValue}
        numberFormat={numberFormat}
        exponent={exponent}
        point={point}
      />
    </>
  );
}
const field = () => screen.getByLabelText("Monto") as HTMLInputElement;
const press = async (...keys: string[]) => {
  for (const key of keys) await userEvent.click(screen.getByRole("button", { name: key }));
};
const minor = (format: NumberFormat, exponent: number) =>
  minorOf(parseDecimal(field().value, format)!, exponent);

describe("the record form's keypad writes into the amount (ruling P291)", () => {
  it("builds the amount in pesos with 000, grouped with dots, as the minor units typed", async () => {
    const { container } = renderWithIntl(<Harness numberFormat="DOT_COMMA" point={false} />);
    await press("4", "5", "000");
    expect(field().value).toBe("45.000");
    expect(minor("DOT_COMMA", 2)).toBe("4500000");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("offers the person's decimal point instead of 000 for a currency typed in cents", async () => {
    const { unmount } = renderWithIntl(<Harness numberFormat="COMMA_DOT" point />);
    expect(screen.queryByRole("button", { name: "000" })).toBeNull();
    await press("1", "2", "3", "4", ".", "5");
    expect(field().value).toBe("1,234.5");
    expect(minor("COMMA_DOT", 2)).toBe("123450");
    unmount();
    renderWithIntl(<Harness numberFormat="SPACE_COMMA" point />);
    await press("1", "2", "3", "4", ",", "0", "5");
    expect(field().value).toBe("1 234,05");
    expect(minor("SPACE_COMMA", 2)).toBe("123405");
  });

  it("deletes the last digit and regroups", async () => {
    renderWithIntl(<Harness numberFormat="DOT_COMMA" point={false} />);
    await press("4", "5", "000", "Borrar");
    expect(field().value).toBe("4.500");
  });

  it("still takes what a physical keyboard types, then the keypad goes on from it", async () => {
    renderWithIntl(<Harness numberFormat="DOT_COMMA" point={false} />);
    await userEvent.type(field(), "12");
    await press("000");
    expect(field().value).toBe("12.000");
    expect(minor("DOT_COMMA", 2)).toBe("1200000");
  });

  it("draws every key at least 44 px tall", () => {
    renderWithIntl(<Harness numberFormat="DOT_COMMA" point={false} />);
    const keys = screen.getAllByRole("button");
    expect(keys.map((key) => key.textContent || key.getAttribute("aria-label"))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "000",
      "0",
      "Borrar",
    ]);
    for (const key of keys) expect(key).toHaveClass("min-h-12");
  });
});
