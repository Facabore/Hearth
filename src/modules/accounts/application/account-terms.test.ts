import { describe, expect, it } from "vitest";
import { FixedClock, type LocalDate } from "@/shared/kernel";
import {
  codeOf,
  fakeSpaceAccess,
  fixedTimeZones,
  memoryTm,
  membership,
  money,
  sequentialIds,
  unwrap,
} from "../../../../tests/support/fakes";
import { FixedMovements, InMemoryAccounts } from "../../../../tests/support/in-memory-accounts";
import { createArchiveAccount } from "./archive-account";
import { createCreateAccount } from "./create-account";
import type { AccountsDeps } from "./deps";
import { createGetAccount, createListAccounts } from "./list-accounts";
import { createUpdateAccount } from "./update-account";

const asAna = { spaceId: "space-ana", userId: "u-ana" };
/** Ana's personal space on 2026-10-16 at 12:00 UTC (07:00 in Bogotá); her zone unless `zone` says otherwise. */
const setup = (zone?: string, now = new Date("2026-10-16T12:00:00Z")) => {
  const deps: AccountsDeps = {
    accounts: new InMemoryAccounts(),
    access: fakeSpaceAccess(membership()),
    movements: new FixedMovements(),
    ids: sequentialIds("acc"),
    clock: new FixedClock(now),
    userTimeZones: fixedTimeZones(zone ? { "u-ana": zone } : {}),
    tm: memoryTm,
  };
  return {
    create: createCreateAccount(deps),
    update: createUpdateAccount(deps),
    archive: createArchiveAccount(deps),
    get: createGetAccount(deps),
    list: createListAccounts(deps),
  };
};
const visa = {
  ...asAna,
  name: "Visa",
  type: "CREDIT_CARD" as const,
  openingBalance: money(-35_000_000n),
  terms: { creditLimit: money(500_000_000n), cutOffDay: 20, paymentDay: 5, monthlyRatePpm: 20_000 },
};

describe("type-specific terms (HU-E2-06)", () => {
  it("returns a card's terms with its available credit, next dates and effective annual rate", async () => {
    const card = unwrap(await setup().create(visa));
    expect(card.terms).toMatchObject({
      creditLimit: 500_000_000n,
      cutOffDay: 20,
      paymentDay: 5,
      monthlyRatePpm: 20_000,
    });
    expect(card.figures).toMatchObject({
      availableCredit: 465_000_000n,
      nextCutOffDate: "2026-10-20",
      nextPaymentDate: "2026-11-05",
      effectiveAnnualRatePpm: 268_242,
    });
  });

  it("returns a CDT with its start date, and a loan with its equivalent monthly rate", async () => {
    const w = setup();
    const cdt = unwrap(
      await w.create({
        ...asAna,
        name: "CDT Davivienda",
        type: "SAVINGS",
        openingBalance: money(1_000_000_000n),
        terms: { annualRatePpm: 95_000, termDays: 180, maturityDate: "2027-04-14" as LocalDate },
      }),
    );
    expect(cdt.figures.startDate).toBe("2026-10-16");
    const loan = unwrap(
      await w.create({
        ...asAna,
        name: "Crédito libre inversión",
        type: "LOAN",
        openingBalance: money(-2_000_000_000n),
        terms: { principal: money(2_000_000_000n), annualRatePpm: 180_000, termMonths: 36 },
      }),
    );
    expect(loan.figures.equivalentMonthlyRatePpm).toBe(13_888);
  });

  it("refuses terms of another type, another currency, and a type change before any term", async () => {
    const w = setup();
    const bank = unwrap(
      await w.create({ ...asAna, name: "Bancolombia", type: "BANK", openingBalance: money(0n) }),
    );
    const change = (changes: Parameters<ReturnType<typeof createUpdateAccount>>[0]["changes"]) =>
      w.update({ ...asAna, accountId: bank.id, changes });
    expect(codeOf(await change({ terms: { creditLimit: money(100_000_000n) } }))).toBe(
      "AccountAttributeNotAllowed",
    );
    expect(codeOf(await change({ type: "CREDIT_CARD", terms: { creditLimit: money(100_000_000n) } }))).toBe(
      "AccountTypeImmutable",
    );
    expect(
      codeOf(await w.create({ ...visa, name: "USD card", terms: { creditLimit: money(100n, "USD") } })),
    ).toBe("CurrencyMismatch");
  });

  it("dates the next cut-off with today in the requester's zone (Review Focus 4)", async () => {
    // 2026-10-21T02:00Z is still the 20th in Bogotá and already the 21st in Madrid.
    const at = new Date("2026-10-21T02:00:00Z");
    const inBogota = unwrap(await setup(undefined, at).create(visa));
    const inMadrid = unwrap(await setup("Europe/Madrid", at).create(visa));
    expect([inBogota.figures.nextCutOffDate, inMadrid.figures.nextCutOffDate]).toEqual([
      "2026-10-20",
      "2026-11-20",
    ]);
  });

  it("revises some terms, keeps the rest, and answers every read and write with the same figures", async () => {
    // 2026-10-21T02:00Z is the 21st in Madrid: this month's cut-off day has already passed.
    const w = setup("Europe/Madrid", new Date("2026-10-21T02:00:00Z"));
    const card = unwrap(await w.create(visa));
    const revised = unwrap(
      await w.update({
        ...asAna,
        accountId: card.id,
        changes: { terms: { creditLimit: money(600_000_000n), paymentDay: null } },
      }),
    );
    expect(revised.terms).toMatchObject({
      creditLimit: 600_000_000n,
      cutOffDay: 20,
      paymentDay: null,
      monthlyRatePpm: 20_000,
    });
    expect(revised.figures).toMatchObject({
      availableCredit: 565_000_000n,
      nextCutOffDate: "2026-11-20",
      nextPaymentDate: null,
    });
    const read = unwrap(await w.get({ ...asAna, accountId: card.id }));
    const [listed] = unwrap(await w.list({ ...asAna, includeArchived: false }));
    const archived = unwrap(await w.archive({ ...asAna, accountId: card.id }));
    expect([read.figures, listed?.figures, archived.figures]).toEqual([
      revised.figures,
      revised.figures,
      revised.figures,
    ]);
  });

  it("refuses a loan's principal in another currency", async () => {
    const loan = {
      ...asAna,
      name: "Crédito libre inversión",
      type: "LOAN" as const,
      openingBalance: money(-2_000_000_000n),
      terms: { principal: money(100n, "USD"), annualRatePpm: 180_000, termMonths: 36 },
    };
    expect(codeOf(await setup().create(loan))).toBe("CurrencyMismatch");
  });
});
