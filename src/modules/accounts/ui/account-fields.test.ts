import { describe, expect, it } from "vitest";
import { ACCOUNT_TYPES, switchesOf } from "@/modules/accounts/domain/account";
import { accountBodyOf, accountFieldOf, FIELDS_BY_TYPE, SWITCH_DEFAULTS } from "./account-fields";

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
