import { describe, expect, it } from "vitest";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import type { NumberFormat } from "@/shared/ui/format/formatters";
import { keypadInput, type KeypadKey } from "./keypad-input";

describe("the record form's keypad writes into the amount (ruling P291)", () => {
  const press = (keys: readonly KeypadKey[], format: NumberFormat, exponent: number, from = "") =>
    keys.reduce((text, key) => keypadInput(text, key, format, exponent), from);
  const minor = (text: string, format: NumberFormat, exponent: number) =>
    minorOf(parseDecimal(text, format)!, exponent);

  it("groups the digits as the person's number format writes them, and reads as the minor units typed", () => {
    const cop = press(["4", "5", "000"], "DOT_COMMA", 2);
    expect(cop).toBe("45.000");
    expect(minor(cop, "DOT_COMMA", 2)).toBe("4500000");
    const usd = press(["1", "2", "3", "4", "point", "5"], "COMMA_DOT", 2);
    expect(usd).toBe("1,234.5");
    expect(minor(usd, "COMMA_DOT", 2)).toBe("123450");
    const eur = press(["1", "2", "3", "4", "point", "0", "5"], "SPACE_COMMA", 2);
    expect(eur).toBe("1 234,05");
    expect(minor(eur, "SPACE_COMMA", 2)).toBe("123405");
  });

  it("deletes the last digit and regroups", () => {
    expect(press(["back"], "DOT_COMMA", 2, "45.000")).toBe("4.500");
    expect(press(["back"], "COMMA_DOT", 2, "1,234.5")).toBe("1,234.");
    expect(press(["back", "back"], "COMMA_DOT", 2, "1,234.5")).toBe("1,234");
    expect(press(["back"], "DOT_COMMA", 2, "")).toBe("");
  });

  it("refuses a point the currency has no room for, a second point, and decimals past the currency's", () => {
    expect(press(["point"], "DOT_COMMA", 0, "45")).toBe("45");
    expect(press(["point"], "COMMA_DOT", 2, "4.5")).toBe("4.5");
    expect(press(["9"], "COMMA_DOT", 2, "4.55")).toBe("4.55");
    expect(press(["000"], "COMMA_DOT", 2, "4.5")).toBe("4.5");
  });

  it("starts a point at 0 and never starts the amount with zeros", () => {
    expect(press(["point", "5"], "DOT_COMMA", 2)).toBe("0,5");
    expect(press(["000"], "DOT_COMMA", 2)).toBe("");
    expect(press(["0", "7"], "DOT_COMMA", 2)).toBe("7");
  });
});
