import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ICONS,
  ACCOUNT_PRODUCT_TYPES,
  ACCOUNT_TYPES,
  productTypesOf,
  switchesOf,
} from "@/modules/accounts/domain/account";
import { accountDto, cop } from "../../../../tests/support/ui/dto";
import {
  accountBodyOf,
  accountFieldOf,
  editBodyOf,
  editOf,
  FIELDS_BY_TYPE,
  SWITCH_DEFAULTS,
} from "./account-fields";
import { ACCOUNT_ICON_CHOICES, PRODUCT_TYPE_CHOICES } from "./account-look";

describe("account form fields (HU-E9-03, ruling P131)", () => {
  it("shows each type's default switches exactly as the API applies them", () => {
    for (const type of ACCOUNT_TYPES) {
      expect(SWITCH_DEFAULTS[type]).toEqual(
        switchesOf({ type, includeInAvailable: null, includeInNetWorth: null }),
      );
    }
  });

  it("asks for a product type exactly where the API takes one, with the API's choices (P295)", () => {
    expect(PRODUCT_TYPE_CHOICES).toEqual(ACCOUNT_PRODUCT_TYPES);
    for (const type of ACCOUNT_TYPES)
      expect(FIELDS_BY_TYPE[type].includes("productType")).toBe(productTypesOf(type).length > 0);
  });

  it("asks a card for its limit, days and rate, and cash for nothing", () => {
    expect(FIELDS_BY_TYPE.CREDIT_CARD).toEqual([
      "institution",
      "lastFour",
      "creditLimit",
      "cutOffDay",
      "paymentDay",
      "monthlyRate",
    ]);
    expect(FIELDS_BY_TYPE.CASH).toEqual([]);
  });

  it("builds a card's body: owed balance negative, terms typed, untouched switches left out", () => {
    const body = accountBodyOf(
      {
        type: "CREDIT_CARD",
        name: " Visa ",
        opening: "350.000",
        fields: {
          creditLimit: "5.000.000",
          cutOffDay: "25",
          paymentDay: "15",
          lastFour: "4821",
          monthlyRate: "1,89",
        },
        includeInAvailable: null,
        includeInNetWorth: null,
      },
      "COP",
      "DOT_COMMA",
    );
    expect(body).toEqual({
      ok: true,
      body: {
        name: "Visa",
        type: "CREDIT_CARD",
        openingBalance: { amount: "-35000000", currency: "COP" },
        lastFour: "4821",
        terms: {
          creditLimit: { amount: "500000000", currency: "COP" },
          cutOffDay: 25,
          paymentDay: 15,
          monthlyRate: "1.89",
        },
      },
    });
  });

  it("sends an empty opening balance as 0 (issue #178)", () => {
    const draft = {
      type: "BANK",
      name: "B",
      opening: "  ",
      fields: {},
      includeInAvailable: null,
      includeInNetWorth: null,
    } as const;
    expect(accountBodyOf(draft, "COP", "DOT_COMMA")).toMatchObject({
      ok: true,
      body: { openingBalance: { amount: "0", currency: "COP" } },
    });
  });

  it("points an unreadable amount at its field and maps API codes and paths", () => {
    const draft = {
      type: "BANK",
      name: "B",
      opening: "dos",
      fields: {},
      includeInAvailable: null,
      includeInNetWorth: null,
    } as const;
    expect(accountBodyOf(draft, "COP", "DOT_COMMA")).toEqual({ ok: false, field: "opening" });
    const p = (code: string, extra = {}) => ({
      code,
      status: 409,
      requestId: "r",
      errors: [],
      field: null,
      ...extra,
    });
    expect(accountFieldOf(p("AccountNameTaken"))).toBe("name");
    expect(accountFieldOf(p("AccountAttributeNotAllowed", { field: "monthlyRate" }))).toBe("monthlyRate");
    expect(
      accountFieldOf(p("ValidationFailed", { errors: [{ path: "terms.cutOffDay", message: "x" }] })),
    ).toBe("cutOffDay");
    expect(accountFieldOf(p("InvalidBillingDay"))).toBe("form");
  });
});

describe("the account edit form's values (issue 169)", () => {
  const visa = accountDto({
    name: "Visa",
    type: "CREDIT_CARD",
    openingBalance: cop(-350_000),
    // 180.400 spent on it since it was opened: 530.400 owed today.
    balance: cop(-530_400),
    lastFour: "4821",
    icon: "star",
    includeInAvailable: false,
    stored: { icon: "star", includeInAvailable: null, includeInNetWorth: null },
    defaults: { icon: "card", includeInAvailable: false, includeInNetWorth: true },
    terms: { ...accountDto().terms, creditLimit: cop(5_000_000), cutOffDay: 25, monthlyRate: "1.8900" },
  });

  it("offers every icon the API takes, in its order", () => {
    expect(ACCOUNT_ICON_CHOICES).toEqual(ACCOUNT_ICONS);
  });

  it("starts from the account as stored, each number as the person types it, a card at what it owes today", () => {
    expect(editOf(visa, "DOT_COMMA")).toEqual({
      name: "Visa",
      // Owner, 2026-11-13: "Debes hoy" counts the movements since the card was opened.
      opening: "530.400",
      openingNegative: true,
      today: { opening: "-35000000", balance: "-53040000" },
      fields: { lastFour: "4821", creditLimit: "5.000.000", cutOffDay: "25", monthlyRate: "1,89" },
      icon: "star",
      includeInAvailable: null,
      includeInNetWorth: null,
    });
    expect(editOf(visa, "COMMA_DOT").fields.monthlyRate).toBe("1.89");
    // Only a fraction's zeros go: a whole rate keeps its own.
    const rateOf = (annualRate: string) =>
      editOf(accountDto({ type: "SAVINGS", terms: { ...accountDto().terms, annualRate } }), "DOT_COMMA")
        .fields.annualRate;
    expect(["10.0000", "12.5000", "10", "0.0500"].map(rateOf)).toEqual(["10", "12,5", "10", "0,05"]);
  });

  it("sends only what changed: an emptied attribute and a style back to its default as null", () => {
    const before = editOf(visa, "DOT_COMMA");
    const after = {
      ...before,
      name: " Visa Oro ",
      fields: { ...before.fields, lastFour: "", cutOffDay: "20" },
      icon: null,
      includeInAvailable: true,
    };
    expect(editBodyOf("CREDIT_CARD", before, after, "COP", "DOT_COMMA")).toEqual({
      ok: true,
      body: {
        name: "Visa Oro",
        lastFour: null,
        terms: { cutOffDay: 20 },
        icon: null,
        includeInAvailable: true,
      },
    });
    expect(editBodyOf("CREDIT_CARD", before, before, "COP", "DOT_COMMA")).toEqual({ ok: true, body: {} });
  });

  it("moves the opening balance by what today's debt changed, and points at a field it cannot read", () => {
    const before = editOf(visa, "DOT_COMMA");
    // 400.000 owed today instead of 530.400: the opening debt drops by 130.400, from 350.000 to 219.600.
    expect(editBodyOf("CREDIT_CARD", before, { ...before, opening: "400.000" }, "COP", "DOT_COMMA")).toEqual({
      ok: true,
      body: { openingBalance: { amount: "-21960000", currency: "COP" } },
    });
    // Nothing owed today: the opening balance covers the 180.400 spent since.
    expect(editBodyOf("CREDIT_CARD", before, { ...before, opening: "" }, "COP", "DOT_COMMA")).toEqual({
      ok: true,
      body: { openingBalance: { amount: "18040000", currency: "COP" } },
    });
    const cleared = { ...before, fields: { ...before.fields, creditLimit: "", cutOffDay: "" } };
    expect(editBodyOf("CREDIT_CARD", before, cleared, "COP", "DOT_COMMA")).toEqual({
      ok: true,
      body: { terms: { creditLimit: null, cutOffDay: null } },
    });
    const unreadable = { ...before, fields: { ...before.fields, creditLimit: "cinco" } };
    expect(editBodyOf("CREDIT_CARD", before, unreadable, "COP", "DOT_COMMA")).toEqual({
      ok: false,
      field: "creditLimit",
    });
  });

  it("keeps the opening balance's sign: a card in credit stays positive, an overdrawn bank stays negative", () => {
    const edited = (account: ReturnType<typeof accountDto>) => {
      const before = editOf(account, "DOT_COMMA");
      return editBodyOf(account.type, before, { ...before, opening: "60.000" }, "COP", "DOT_COMMA");
    };
    const amountOf = (built: ReturnType<typeof edited>) =>
      built.ok ? (built.body.openingBalance as { amount: string }).amount : null;
    // A card in credit by 50.000 since it was opened, with no movement: today's 60.000 in credit is its opening.
    expect(
      amountOf(edited(accountDto({ type: "CREDIT_CARD", openingBalance: cop(50_000), balance: cop(50_000) }))),
    ).toBe("6000000");
    expect(amountOf(edited(accountDto({ type: "BANK", openingBalance: cop(-50_000) })))).toBe("-6000000");
    expect(amountOf(edited(accountDto({ type: "LOAN", openingBalance: cop(0) })))).toBe("-6000000");
    expect(amountOf(edited(accountDto({ type: "BANK", openingBalance: cop(0) })))).toBe("6000000");
  });
});
