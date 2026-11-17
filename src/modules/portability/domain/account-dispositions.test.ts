import { describe, expect, it } from "vitest";
import { personNameOf, suggestDisposition, type DispositionFacts } from "./account-dispositions";
import type { HearthAccount } from "./mapping-proposals";
import type { SourceAccount } from "./source-snapshot";

const source = (name: string, overrides: Partial<SourceAccount> = {}): SourceAccount => ({
  sourceId: "a-1",
  name,
  type: "BANK",
  currency: "COP",
  order: 0,
  cutOffDay: null,
  paymentDay: null,
  memo: null,
  hidden: false,
  excludedFromTotals: false,
  ...overrides,
});

const mine = (id: string, name: string, overrides: Partial<HearthAccount> = {}): HearthAccount => ({
  id,
  name,
  currency: "COP",
  archived: false,
  ...overrides,
});

const facts = (overrides: Partial<DispositionFacts> = {}): DispositionFacts => ({
  linked: false,
  movementCount: 3,
  closingBalanceMinor: 50_000_00n,
  spaceCurrency: "COP",
  accounts: [],
  ...overrides,
});

describe("suggestDisposition (P337: ¿Qué es cada cuenta?)", () => {
  it("suggests Cuenta for an ordinary account with movements", () => {
    expect(suggestDisposition(source("Bancolombia"), facts())).toEqual({ kind: "ACCOUNT" });
  });

  it("suggests Persona for Money Manager's Loan group, a loan word or a relationship word, ignoring case and accents", () => {
    for (const name of [
      "Mom Loan",
      "Brother",
      "Préstamo Juan",
      "prestamo a Sam",
      "MAMÁ",
      "Tía Rosa",
      "Mi amigo",
    ]) {
      expect(suggestDisposition(source(name), facts()), name).toEqual({ kind: "PERSON" });
    }
    expect(suggestDisposition(source("Jhon López", { loan: true }), facts())).toEqual({ kind: "PERSON" });
  });

  it("matches relationship words as whole words only", () => {
    // "Mamagallista" holds "mama" but is no relationship word; "Papaya" holds "papa".
    expect(suggestDisposition(source("Mamagallista"), facts())).toEqual({ kind: "ACCOUNT" });
    expect(suggestDisposition(source("Papaya Fund"), facts())).toEqual({ kind: "ACCOUNT" });
  });

  it("keeps an institution's loan an account, even in the Loan group", () => {
    for (const name of [
      "Préstamo Bancolombia",
      "Crédito hipotecario",
      "Loan Bank",
      "ICETEX",
      "Leasing carro",
    ]) {
      expect(suggestDisposition(source(name, { loan: true }), facts()), name).toEqual({ kind: "ACCOUNT" });
    }
  });

  it("never suggests Persona for an account in another currency than the space's: a settlement is in the space's", () => {
    expect(suggestDisposition(source("Mom Loan", { currency: "USD" }), facts())).toEqual({ kind: "ACCOUNT" });
  });

  it("suggests Archivar for a hidden account, and for one with no movements at a zero balance", () => {
    expect(suggestDisposition(source("Old", { hidden: true }), facts())).toEqual({
      kind: "ARCHIVE",
      duplicateOf: null,
    });
    expect(suggestDisposition(source("Card"), facts({ movementCount: 0, closingBalanceMinor: 0n }))).toEqual({
      kind: "ARCHIVE",
      duplicateOf: null,
    });
  });

  it("suggests merging a starter account's duplicate into the person's own one, before any other rule", () => {
    const efectivo = mine("h-cash", "Efectivo");
    const tarjeta = mine("h-card", "Tarjeta de crédito");
    const banco = mine("h-bank", "Cuenta bancaria");
    const accounts = [efectivo, tarjeta, banco];
    expect(suggestDisposition(source("Cash"), facts({ accounts }))).toEqual({
      kind: "ARCHIVE",
      duplicateOf: efectivo,
    });
    expect(suggestDisposition(source("card", { hidden: true }), facts({ accounts }))).toEqual({
      kind: "ARCHIVE",
      duplicateOf: tarjeta,
    });
    expect(
      suggestDisposition(source(" Accounts ", { hidden: true }), facts({ accounts, movementCount: 0 })),
    ).toEqual({ kind: "ARCHIVE", duplicateOf: banco });
  });

  it("is no duplicate when the person has an account of that very name, one in another currency, or an archived one", () => {
    expect(
      suggestDisposition(source("Cash"), facts({ accounts: [mine("h-1", "Efectivo"), mine("h-2", "cash")] })),
    ).toEqual({ kind: "ACCOUNT" });
    expect(
      suggestDisposition(source("Cash"), facts({ accounts: [mine("h-1", "Efectivo", { currency: "USD" })] })),
    ).toEqual({ kind: "ACCOUNT" });
    expect(
      suggestDisposition(source("Cash"), facts({ accounts: [mine("h-1", "Efectivo", { archived: true })] })),
    ).toEqual({ kind: "ACCOUNT" });
  });

  it("keeps an account an earlier import linked a Cuenta, whatever it looks like", () => {
    expect(
      suggestDisposition(source("Mom Loan", { hidden: true }), facts({ linked: true, movementCount: 0 })),
    ).toEqual({ kind: "ACCOUNT" });
  });
});

describe("personNameOf", () => {
  it("drops the loan words and keeps the person's name", () => {
    expect(personNameOf("Mom Loan")).toBe("Mom");
    expect(personNameOf("Brother Loan")).toBe("Brother");
    expect(personNameOf("Préstamo - Juan")).toBe("Juan");
    expect(personNameOf("Jhon López")).toBe("Jhon López");
  });

  it("keeps the name as it is when nothing else is left", () => {
    expect(personNameOf("Loan")).toBe("Loan");
  });
});
