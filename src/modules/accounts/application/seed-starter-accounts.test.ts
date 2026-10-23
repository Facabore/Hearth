import { describe, expect, it } from "vitest";
import { FixedClock } from "@/shared/kernel";
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
import { NO_ATTRIBUTES } from "../domain/account";
import { createArchiveAccount } from "./archive-account";
import { createCreateAccount } from "./create-account";
import type { AccountsDeps } from "./deps";
import { createSeedStarterAccounts } from "./seed-starter-accounts";

const asAna = { spaceId: "space-ana", userId: "u-ana" };
const household = membership({ spaceId: "space-household", spaceKind: "SHARED", name: "Household" });
const anaAsViewer = membership({ spaceId: "space-viewer", memberId: "member-viewer", role: "VIEWER" });

const setup = () => {
  const accounts = new InMemoryAccounts();
  const deps: AccountsDeps = {
    accounts,
    access: fakeSpaceAccess(membership(), household, anaAsViewer),
    movements: new FixedMovements(),
    ids: sequentialIds("acc"),
    clock: new FixedClock(new Date("2026-10-22T12:00:00Z")),
    userTimeZones: fixedTimeZones(),
    tm: memoryTm,
  };
  return {
    accounts,
    seed: createSeedStarterAccounts(deps),
    create: createCreateAccount(deps),
    archive: createArchiveAccount(deps),
  };
};

const SPANISH = [
  ["Efectivo", "CASH"],
  ["Cuenta bancaria", "BANK"],
  ["Billetera digital", "WALLET"],
  ["Tarjeta de crédito", "CREDIT_CARD"],
  ["Ahorros", "SAVINGS"],
];

describe("SeedStarterAccounts (issue 169)", () => {
  it("opens the five starter accounts at zero, owned by her, with no attributes and the types' switches", async () => {
    const { accounts, seed } = setup();
    const created = unwrap(await seed({ ...asAna, locale: "es-CO" }));
    expect(created.map((a) => [a.name, a.type])).toEqual(SPANISH);
    for (const view of created) {
      expect(view).toMatchObject({
        spaceId: "space-ana",
        ownerUserId: "u-ana",
        openingBalance: 0n,
        balance: 0n,
        currency: "COP",
        archivedAt: null,
        ...NO_ATTRIBUTES,
      });
    }
    expect(accounts.rows.map((a) => a.name)).toEqual(SPANISH.map(([name]) => name));
  });

  it("names them in English for an en locale", async () => {
    const { seed } = setup();
    const created = unwrap(await seed({ ...asAna, locale: "en" }));
    expect(created.map((a) => [a.name, a.type])).toEqual([
      ["Cash", "CASH"],
      ["Bank account", "BANK"],
      ["Digital wallet", "WALLET"],
      ["Credit card", "CREDIT_CARD"],
      ["Savings", "SAVINGS"],
    ]);
  });

  it("creates only the names the space does not hold yet, ignoring case and counting archived ones", async () => {
    const { accounts, seed, create, archive } = setup();
    unwrap(await create({ ...asAna, name: "efectivo", type: "WALLET", openingBalance: money(5_000n) }));
    const savings = unwrap(
      await create({ ...asAna, name: "Ahorros", type: "SAVINGS", openingBalance: money(0n) }),
    );
    unwrap(await archive({ ...asAna, accountId: savings.id }));
    const created = unwrap(await seed({ ...asAna, locale: "es" }));
    expect(created.map((a) => a.name)).toEqual([
      "Cuenta bancaria",
      "Billetera digital",
      "Tarjeta de crédito",
    ]);
    expect(accounts.rows).toHaveLength(5);
  });

  it("is idempotent: a second call creates nothing", async () => {
    const { accounts, seed } = setup();
    unwrap(await seed({ ...asAna, locale: "es" }));
    expect(unwrap(await seed({ ...asAna, locale: "es" }))).toEqual([]);
    expect(accounts.rows).toHaveLength(5);
  });

  it("refuses a shared space, a member who does not manage the space, and hides other spaces", async () => {
    const { accounts, seed } = setup();
    expect(codeOf(await seed({ spaceId: "space-household", userId: "u-ana", locale: "es" }))).toBe(
      "PersonalAccountRequiresPersonalSpace",
    );
    expect(codeOf(await seed({ spaceId: "space-viewer", userId: "u-ana", locale: "es" }))).toBe(
      "InsufficientRole",
    );
    expect(codeOf(await seed({ spaceId: "space-ana", userId: "u-luis", locale: "es" }))).toBe(
      "SpaceNotFound",
    );
    expect(accounts.rows).toEqual([]);
  });
});
