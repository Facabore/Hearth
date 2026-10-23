import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import type { NumberRule } from "../format/number-input";
import { NumberField } from "./number-field";

function Harness(
  props: NumberRule & { hint?: string; unit?: string; symbol?: string; example?: string | false },
) {
  const [value, setValue] = useState("");
  return <NumberField id="n" label="Valor" value={value} onChange={setValue} {...props} />;
}
const field = () => screen.getByLabelText("Valor") as HTMLInputElement;

describe("NumberField (issue #164)", () => {
  it("drops a letter and a fifth digit from a four-digit code", async () => {
    renderWithIntl(<Harness kind="digits" numberFormat="DOT_COMMA" maxLength={4} />);
    await userEvent.type(field(), "4a8b2c1d5");
    expect(field()).toHaveValue("4821");
    expect(field()).toHaveAttribute("inputmode", "numeric");
  });

  it("keeps one decimal point of the person's format in a rate", async () => {
    renderWithIntl(<Harness kind="decimal" numberFormat="DOT_COMMA" decimals={4} unit="%" />);
    await userEvent.type(field(), "2x2.3,4");
    expect(field()).toHaveValue("22,34");
    expect(field()).toHaveAttribute("inputmode", "decimal");
  });

  it("groups money while typing and keeps the caret after the digit typed", async () => {
    renderWithIntl(<Harness kind="money" numberFormat="DOT_COMMA" decimals={2} symbol="$" />);
    await userEvent.type(field(), "6000");
    expect(field()).toHaveValue("6.000");
    field().setSelectionRange(1, 1);
    await userEvent.keyboard("5");
    expect(field()).toHaveValue("65.000");
    expect(field().selectionStart).toBe(2);
  });

  it("does not move the caret when a dropped character is typed in the middle", async () => {
    renderWithIntl(<Harness kind="integer" numberFormat="DOT_COMMA" />);
    await userEvent.type(field(), "1234");
    field().setSelectionRange(2, 2);
    await userEvent.keyboard("x");
    expect(field()).toHaveValue("1234");
    expect(field().selectionStart).toBe(2);
  });

  it("shows the expected format before typing, in Spanish with the person's format", async () => {
    const { container } = renderWithIntl(
      <Harness kind="money" numberFormat="DOT_COMMA" decimals={2} symbol="$" />,
    );
    expect(field()).toHaveAccessibleDescription("Ej: 1.250,50");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows the expected format in English with the person's format", () => {
    renderWithIntl(<Harness kind="decimal" numberFormat="COMMA_DOT" unit="%" />, { locale: "en" });
    expect(field()).toHaveAccessibleDescription("e.g. 12.5");
  });

  it("follows the person's format, not the language's", () => {
    renderWithIntl(<Harness kind="money" numberFormat="DOT_COMMA" decimals={2} />, { locale: "en" });
    expect(field()).toHaveAccessibleDescription("e.g. 1.250,50");
  });

  it("puts a caller's hint before the example, and a code has only the hint", () => {
    renderWithIntl(
      <Harness
        kind="digits"
        numberFormat="DOT_COMMA"
        maxLength={4}
        hint="Opcional: para distinguir dos cuentas"
      />,
    );
    expect(field()).toHaveAccessibleDescription("Opcional: para distinguir dos cuentas");
  });
});
