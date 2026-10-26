import { describe, expect, it } from "vitest";
import { ACCOUNT_ICONS, ACCOUNT_TYPES, switchesOf } from "@/modules/accounts/domain/account";
import { accountDto, cop } from "../../../../tests/support/ui/dto";
import {
  accountBodyOf,
  accountFieldOf,
  editBodyOf,
  editOf,
  FIELDS_BY_TYPE,
  SWITCH_DEFAULTS,
} from "./account-fields";
import { ACCOUNT_ICON_CHOICES } from "./account-look";

describe("account form fields (HU-E9-03, ruling P131)", () => {
  it("shows each type's default switches exactly as the API applies them", () => {
    for (const type of ACCOUNT_TYPES) {
      expect(SWITCH_DEFAULTS[type]).toEqual(
        switchesOf({ type, includeInAvailable: null, includeInNetWorth: null }),
      );
    }
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

  it("starts from the account as stored, each number as the person types it", () => {
    expect(editOf(visa, "DOT_COMMA")).toEqual({
      name: "Visa",
      opening: "350.000",
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

  it("sends a changed debt negative, and points at a field it cannot read", () => {
    const before = editOf(visa, "DOT_COMMA");
    expect(editBodyOf("CREDIT_CARD", before, { ...before, opening: "400.000" }, "COP", "DOT_COMMA")).toEqual({
      ok: true,
      body: { openingBalance: { amount: "-40000000", currency: "COP" } },
    });
    const unreadable = { ...before, fields: { ...before.fields, creditLimit: "cinco" } };
    expect(editBodyOf("CREDIT_CARD", before, unreadable, "COP", "DOT_COMMA")).toEqual({
      ok: false,
      field: "creditLimit",
    });
  });
});
