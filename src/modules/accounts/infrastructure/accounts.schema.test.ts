import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { ACCOUNT_TYPES } from "../domain/account";
import { MAX_BILLING_DAY, MAX_TERM_DAYS, MAX_TERM_MONTHS, MIN_BILLING_DAY } from "../domain/account-terms";
import { MAX_RATE_PPM } from "../domain/rate";
import { accounts } from "./accounts.schema";

const config = getTableConfig(accounts);
const checkSql = (name: string): string => {
  const check = config.checks.find((c) => c.name === name);
  if (!check) throw new Error(`No check named ${name}`);
  return new PgDialect().sqlToQuery(check.value).sql;
};

describe("accounts schema (issue 122)", () => {
  it("names the term bounds once, in the domain", () => {
    expect([MIN_BILLING_DAY, MAX_BILLING_DAY, MAX_RATE_PPM, MAX_TERM_DAYS, MAX_TERM_MONTHS]).toEqual([
      1, 31, 1_000_000, 3_660, 480,
    ]);
  });

  it("takes the type list from the domain", () => {
    expect(config.columns.find((c) => c.name === "type")?.enumValues).toEqual([...ACCOUNT_TYPES]);
  });

  it.each([
    ["accounts_cut_off_day", `BETWEEN ${MIN_BILLING_DAY} AND ${MAX_BILLING_DAY}`],
    ["accounts_payment_day", `BETWEEN ${MIN_BILLING_DAY} AND ${MAX_BILLING_DAY}`],
    ["accounts_monthly_rate_range", `BETWEEN 0 AND ${MAX_RATE_PPM}`],
    ["accounts_annual_rate_range", `BETWEEN 0 AND ${MAX_RATE_PPM}`],
    ["accounts_term_days_range", `BETWEEN 1 AND ${MAX_TERM_DAYS}`],
    ["accounts_term_months_range", `BETWEEN 1 AND ${MAX_TERM_MONTHS}`],
  ])("writes the bounds of %s from the domain constants", (name, bounds) => {
    expect(checkSql(name)).toContain(bounds);
  });
});
