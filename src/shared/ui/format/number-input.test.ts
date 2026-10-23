import { describe, expect, it } from "vitest";
import type { NumberFormat } from "./formatters";
import { caretIn, exampleOf, filterNumber, inputModeOf, type NumberRule } from "./number-input";

const NBSP = " ";
const es: NumberFormat = "DOT_COMMA";
const en: NumberFormat = "COMMA_DOT";

describe("number fields keep only what their kind holds (issue #164)", () => {
  it("money groups the digits as the person's format writes them, exactly as the amount field did", () => {
    const money = (numberFormat: NumberFormat): NumberRule => ({ kind: "money", numberFormat, decimals: 2 });
    expect(filterNumber("1250,50", money(es))).toBe("1.250,50");
    expect(filterNumber("1250.50", money(en))).toBe("1,250.50");
    expect(filterNumber("1250,5", money("SPACE_COMMA"))).toBe(`1${NBSP}250,5`);
    expect(filterNumber("12a3", money(es))).toBe("123");
    // A point typed by habit stays as typed, so the unreadable-amount message answers (U3).
    expect(filterNumber("12.50", money(es), "12.5")).toBe("12.50");
  });

  it.each<[string, NumberFormat, number | undefined, string]>([
    ["22,3", es, undefined, "22,3"],
    ["22.3", en, undefined, "22.3"],
    ["22.3", es, undefined, "22,3"],
    ["22,3", en, undefined, "22.3"],
    ["2a2,b3%", es, undefined, "22,3"],
    ["1,2,3", es, undefined, "1,23"],
    [",5", es, undefined, "0,5"],
    ["33,555", es, 2, "33,55"],
    ["1,89123", es, 4, "1,8912"],
    ["12,5", es, 0, "125"],
    ["-5", es, undefined, "5"],
  ])("decimal: %j in %s with at most %s decimals → %j", (typed, numberFormat, decimals, kept) => {
    expect(filterNumber(typed, { kind: "decimal", numberFormat, decimals })).toBe(kept);
  });

  it("integer keeps digits only, up to its length", () => {
    expect(filterNumber("1a5.", { kind: "integer", numberFormat: es })).toBe("15");
    expect(filterNumber("123", { kind: "integer", numberFormat: es, maxLength: 2 })).toBe("12");
    expect(filterNumber("3,5", { kind: "integer", numberFormat: en })).toBe("35");
  });

  it("digits keep a fixed-length code: no letters and never a fifth digit", () => {
    const lastFour: NumberRule = { kind: "digits", numberFormat: es, maxLength: 4 };
    expect(filterNumber("48a2", lastFour)).toBe("482");
    expect(filterNumber("48215", lastFour)).toBe("4821");
    expect(filterNumber("4821 5678", lastFour)).toBe("4821");
    expect(filterNumber("·4821", lastFour)).toBe("4821");
    // A digit typed into a full code is refused, wherever the caret is, instead of pushing the last one out.
    expect(filterNumber("94821", lastFour, "4821")).toBe("4821");
    expect(filterNumber("482a1", lastFour, "4821")).toBe("4821");
  });
});

describe("the caret stays where it was once the text is filtered", () => {
  it("money: after the same digit, across a regrouping", () => {
    const rule: NumberRule = { kind: "money", numberFormat: es, decimals: 2 };
    // "6.000" with a 5 typed after the 6: "65.000" → "65.000", caret after the 5.
    expect(caretIn("65.000", 2, filterNumber("65.000", rule), rule)).toBe(2);
    // "600" with a 0 typed at the end: "6000" → "6.000", caret at the end.
    expect(caretIn("6000", 4, "6.000", rule)).toBe(5);
  });

  it("decimal, integer and digits: after the kept characters before it", () => {
    const rate: NumberRule = { kind: "decimal", numberFormat: es };
    // A letter typed in the middle of "12,5" is dropped and the caret does not jump to the end.
    expect(caretIn("12x,5", 3, filterNumber("12x,5", rate), rate)).toBe(2);
    expect(caretIn(",5", 1, "0,5", rate)).toBe(2);
    const lastFour: NumberRule = { kind: "digits", numberFormat: es, maxLength: 4 };
    expect(caretIn("4a821", 2, "4821", lastFour)).toBe(1);
    expect(caretIn("48215", 5, "4821", lastFour)).toBe(4);
  });

  it("a keystroke refused whole leaves the caret where it was before it", () => {
    const lastFour: NumberRule = { kind: "digits", numberFormat: es, maxLength: 4 };
    expect(caretIn("94821", 1, "4821", lastFour, "4821")).toBe(0);
    const money: NumberRule = { kind: "money", numberFormat: es, decimals: 2 };
    expect(caretIn("6x.000", 2, "6.000", money, "6.000")).toBe(1);
  });
});

describe("each kind brings its keyboard and its example", () => {
  it("asks for the numeric keypad where no decimal point can be typed", () => {
    expect(inputModeOf({ kind: "money", numberFormat: es, decimals: 2 })).toBe("decimal");
    expect(inputModeOf({ kind: "money", numberFormat: es, decimals: 0 })).toBe("numeric");
    expect(inputModeOf({ kind: "decimal", numberFormat: es })).toBe("decimal");
    expect(inputModeOf({ kind: "integer", numberFormat: es })).toBe("numeric");
    expect(inputModeOf({ kind: "digits", numberFormat: es, maxLength: 4 })).toBe("numeric");
  });

  it("writes an example in the person's own number format", () => {
    expect(exampleOf({ kind: "money", numberFormat: es, decimals: 2 })).toBe("1.250,50");
    expect(exampleOf({ kind: "money", numberFormat: en, decimals: 2 })).toBe("1,250.50");
    expect(exampleOf({ kind: "money", numberFormat: es, decimals: 0 })).toBe("1.250");
    expect(exampleOf({ kind: "decimal", numberFormat: es })).toBe("12,5");
    expect(exampleOf({ kind: "decimal", numberFormat: en })).toBe("12.5");
    expect(exampleOf({ kind: "decimal", numberFormat: es }, "1.89")).toBe("1,89");
    expect(exampleOf({ kind: "integer", numberFormat: es })).toBe("15");
    expect(exampleOf({ kind: "digits", numberFormat: es, maxLength: 4 })).toBeNull();
  });
});
