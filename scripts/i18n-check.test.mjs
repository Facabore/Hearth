import { describe, expect, it } from "vitest";
import { checkCatalogs, errorCodesOf, warningCodesOf } from "./i18n-check.mjs";

const openapi = {
  paths: {
    "/x": {
      post: {
        responses: {
          201: { description: "Created" },
          401: { description: "Not signed in" },
          409: { description: "OutstandingBalance (with the outstanding amount), SpaceArchived" },
          422: { description: "ValidationFailed (including the template, type, payer), InvalidAmount" },
        },
      },
    },
  },
};
const errors = (codes) => Object.fromEntries(codes.map((code) => [code, code]));
const withWarnings = {
  ...openapi,
  components: {
    schemas: {
      RecordedExpense: {
        type: "object",
        properties: {
          warnings: {
            type: "array",
            items: {
              type: "object",
              properties: { code: { type: "string", enum: ["FundBalanceNegative"] } },
            },
          },
        },
      },
    },
  },
};

describe("i18n:check (HU-E9-02)", () => {
  it("reads every error code named in the 4xx and 5xx descriptions, plus the codes the UI always shows", () => {
    expect(errorCodesOf(openapi)).toEqual([
      "InternalError",
      "InvalidAmount",
      "OutstandingBalance",
      "SpaceArchived",
      "Unknown",
      "ValidationFailed",
    ]);
  });

  it("fails naming the key missing in en", () => {
    const base = { errors: errors(errorCodesOf(openapi)) };
    const es = { ...base, ledger: { expense: { title: "Nuevo gasto" } } };
    expect(checkCatalogs({ es, en: base, openapi })).toEqual(["Missing in en: ledger.expense.title"]);
  });

  it("fails naming an error code without a message, and a key that is not a message", () => {
    const es = {
      errors: { ...errors(errorCodesOf(openapi)), SpaceArchived: undefined },
      common: { save: 3 },
    };
    const en = { errors: errors(errorCodesOf(openapi)), common: { save: "Save" } };
    expect(checkCatalogs({ es, en, openapi })).toEqual([
      "Not a message in es: common.save",
      "Missing in es: errors.SpaceArchived",
    ]);
  });

  it("reads every warning code and fails naming one without a message (ruling P170)", () => {
    expect(warningCodesOf(withWarnings)).toEqual(["FundBalanceNegative"]);
    const both = { errors: errors(errorCodesOf(withWarnings)) };
    expect(checkCatalogs({ es: both, en: both, openapi: withWarnings })).toEqual([
      "Missing in es: warnings.FundBalanceNegative",
      "Missing in en: warnings.FundBalanceNegative",
    ]);
    const done = { ...both, warnings: { FundBalanceNegative: "x" } };
    expect(checkCatalogs({ es: done, en: done, openapi: withWarnings })).toEqual([]);
  });

  it("passes when both catalogs hold the same messages and every code", () => {
    const both = { errors: errors(errorCodesOf(openapi)) };
    expect(checkCatalogs({ es: both, en: both, openapi })).toEqual([]);
  });
});
