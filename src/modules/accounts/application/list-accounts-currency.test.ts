import { describe, expect, it } from "vitest";
import { domainError, err, ExchangeRate, FixedClock, ok, type LocalDate } from "@/shared/kernel";
import {
  fakeSpaceAccess,
  fixedTimeZones,
  memoryTm,
  membership,
  noSpaceLocks,
  sequentialIds,
  unwrap,
} from "../../../../tests/support/fakes";
import { FixedMovements, InMemoryAccounts } from "../../../../tests/support/in-memory-accounts";
import { NO_ATTRIBUTES, type Account, type AccountId } from "../domain/account";
import type { AccountsDeps } from "./deps";
import { createListAccounts } from "./list-accounts";
import type { AccountRates } from "./rates";

const now = new Date("2026-11-16T12:00:00Z");
const asAna = { spaceId: "space-ana", userId: "u-ana", includeArchived: false };
const account = (id: string, name: string, overrides: Partial<Account> = {}): Account => ({
  id: id as AccountId,
  spaceId: "space-ana",
  name,
  type: "BANK",
  ownerUserId: "u-ana",
  currency: "COP",
  openingBalance: 146_960_000n,
  archivedAt: null,
  createdAt: now,
  ...NO_ATTRIBUTES,
  ...overrides,
});

/** Stored rates as the rates module dates them (MC2); a pair asked for on another day reads the same stored row. */
const storedRates = (...rows: { base: string; quote: string; rate: string; date: string }[]) => {
  const asked: LocalDate[] = [];
  const rates: AccountRates = {
    datedRateOn: async (base, quote, on) => {
      asked.push(on);
      const row = rows.find((r) => r.base === base && r.quote === quote && r.date <= on);
      if (!row) return err(domainError("NoExchangeRate", { base, quote }));
      const date = row.date as LocalDate;
      return ok({ rate: unwrap(ExchangeRate.of(base, quote, row.rate)), date, stale: on > "2026-11-22" });
    },
  };
  return { rates, asked };
};

const setup = (rates: AccountRates | undefined, ...accounts: Account[]) => {
  const repository = new InMemoryAccounts();
  repository.rows.push(...accounts);
  const deps: AccountsDeps = {
    spaceLocks: noSpaceLocks,
    accounts: repository,
    access: fakeSpaceAccess(membership()),
    movements: new FixedMovements({}),
    ids: sequentialIds("acc"),
    clock: new FixedClock(now),
    userTimeZones: fixedTimeZones(),
    rates,
    tm: memoryTm,
  };
  return createListAccounts(deps);
};

const usd = account("acc-usd", "Cuenta en dólares", { currency: "USD", openingBalance: 51_240n });

describe("space totals converted on read (D29, slice MC4)", () => {
  it("converts the USD account into COP at the latest rate on or before today, with the rate's own day", async () => {
    const { rates, asked } = storedRates({ base: "USD", quote: "COP", rate: "4100", date: "2026-11-15" });
    const list = unwrap(await setup(rates, account("acc-cop", "Bancolombia"), usd)(asAna));
    // $ 1.469.600 + US$ 512,40 at 4.100 ($ 2.100.840) is ≈ $ 3.570.440.
    expect(list.totals).toEqual({ available: 357_044_000n, netWorth: 357_044_000n });
    expect(list.conversion.rates).toMatchObject([{ currency: "USD", date: "2026-11-15", stale: false }]);
    expect(list.conversion.converted.get("acc-usd")).toBe(210_084_000n);
    expect(asked).toEqual(["2026-11-16"]);
  });

  it("reads the rate on or before the day asked for", async () => {
    const { rates, asked } = storedRates({ base: "USD", quote: "COP", rate: "4100", date: "2026-11-15" });
    await setup(rates, usd)({ ...asAna, asOf: "2026-11-20" as LocalDate });
    expect(asked).toEqual(["2026-11-20"]);
  });

  it("leaves the USD account out and flags it when there is no rate", async () => {
    const { rates } = storedRates();
    const list = unwrap(await setup(rates, account("acc-cop", "Bancolombia"), usd)(asAna));
    expect(list.totals).toEqual({ available: 146_960_000n, netWorth: 146_960_000n });
    expect(list.conversion.withoutRate).toEqual(["acc-usd"]);
  });

  it("flags a stale rate and still converts with it", async () => {
    const { rates } = storedRates({ base: "USD", quote: "COP", rate: "4100", date: "2026-11-15" });
    const list = unwrap(await setup(rates, usd)({ ...asAna, asOf: "2026-11-25" as LocalDate }));
    expect(list.totals.available).toBe(210_084_000n);
    expect(list.conversion.rates).toMatchObject([{ date: "2026-11-15", stale: true }]);
  });

  it("subtracts a converted debt from net worth: a USD credit card owing US$ 100", async () => {
    const { rates } = storedRates({ base: "USD", quote: "COP", rate: "4100", date: "2026-11-15" });
    const card = account("acc-card", "Visa USD", {
      type: "CREDIT_CARD",
      currency: "USD",
      openingBalance: -10_000n,
    });
    const list = unwrap(await setup(rates, account("acc-cop", "Bancolombia"), card)(asAna));
    // US$ -100 at 4.100 is $ -410.000: out of net worth, and a card never counts in the available money.
    expect(list.totals).toEqual({ available: 146_960_000n, netWorth: 105_960_000n });
    expect(list.conversion.converted.get("acc-card")).toBe(-41_000_000n);
  });

  it("answers the rates port's failure instead of reading it as no rate", async () => {
    const failing: AccountRates = {
      datedRateOn: async () => err(domainError("ExchangeRateSourceUnavailable")),
    };
    const listed = await setup(failing, account("acc-cop", "Bancolombia"), usd)(asAna);
    expect(!listed.ok && listed.error.code).toBe("ExchangeRateSourceUnavailable");
  });
});
