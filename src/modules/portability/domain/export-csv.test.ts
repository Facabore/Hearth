import { describe, expect, it } from "vitest";
import { csvTable, decimalCell, textCell } from "./export-csv";

describe("textCell (design §3.6, RFC 4180)", () => {
  it("writes plain text as it is", () => {
    expect(textCell("Mercado")).toBe("Mercado");
    expect(textCell("Café ñandú")).toBe("Café ñandú");
  });

  it("quotes a cell holding a comma, a quote or a line break, doubling the quotes", () => {
    expect(textCell("Pan, leche")).toBe('"Pan, leche"');
    expect(textCell('El "mejor"')).toBe('"El ""mejor"""');
    expect(textCell("una\nlínea")).toBe('"una\nlínea"');
  });

  it("prefixes a cell that a spreadsheet would read as a formula with an apostrophe", () => {
    expect(textCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(textCell("+57 300")).toBe("'+57 300");
    expect(textCell("-5")).toBe("'-5");
    expect(textCell("@cmd")).toBe("'@cmd");
    expect(textCell("\tTab")).toBe("'\tTab");
    expect(textCell("\rReturn")).toBe('"\'\rReturn"');
  });

  it("guards a formula and still quotes it when it holds a comma", () => {
    expect(textCell('=HYPERLINK("x",1)')).toBe('"\'=HYPERLINK(""x"",1)"');
  });
});

describe("decimalCell (design §3.6)", () => {
  it("writes minor units as a plain decimal with a dot, by the currency's exponent", () => {
    expect(decimalCell(1_600_000n, "COP")).toBe("16000.00");
    expect(decimalCell(5n, "USD")).toBe("0.05");
    expect(decimalCell(1500n, "JPY")).toBe("1500");
    expect(decimalCell(1234n, "KWD")).toBe("1.234");
  });

  it("keeps a negative amount a number, never guarded as a formula", () => {
    expect(decimalCell(-250_050n, "COP")).toBe("-2500.50");
    expect(decimalCell(-5n, "USD")).toBe("-0.05");
  });
});

describe("csvTable", () => {
  it("starts with a BOM, joins cells with commas and ends every row with CRLF", () => {
    expect(csvTable(["a", "b"], [["1", "2"]])).toBe("﻿a,b\r\n1,2\r\n");
  });
});
