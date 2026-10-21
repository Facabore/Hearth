import { describe, expect, it } from "vitest";
import { FixedClock, type Result } from "@/shared/kernel";
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
import { NO_ATTRIBUTES, type Account, type AccountId } from "../domain/account";
import { createArchiveAccount } from "./archive-account";
import { createCreateAccount } from "./create-account";
import type { AccountsDeps } from "./deps";
import { createGetAccount, createListAccounts } from "./list-accounts";
import { createRestoreAccount } from "./restore-account";
import { createUpdateAccount } from "./update-account";

const now = new Date("2026-10-12T12:00:00Z");
const ana = { spaceId: "space-ana", userId: "u-ana" };
const household = { spaceId: "space-household", userId: "u-ana" };
const account = (id: string, name: string, overrides: Partial<Account> = {}): Account => ({
  id: id as AccountId,
  spaceId: "space-ana",
  name,
  type: "BANK",
  ownerUserId: "u-ana",
  openingBalance: 200_000_000n,
  archivedAt: null,
  createdAt: now,
  ...NO_ATTRIBUTES,
  ...overrides,
});

/**
 * Where accounts live: personal accounts in Ana's `space-ana`, shared funds in Household; Ana is OWNER of
 * both. Accounts only see the membership's archived flag, so the personal membership stands in for a space
 * whose archived state is not tied to its kind here.
 */
const world = (where: "ana" | "household", archived: boolean, archivedAccounts: readonly string[] = []) => {
  const accounts = new InMemoryAccounts();
  accounts.rows.push(
    account("acc-bancolombia", "Bancolombia"),
    account("acc-fund", "Household Fund", {
      spaceId: "space-household",
      type: "SHARED_FUND",
      ownerUserId: null,
    }),
  );
  accounts.rows = accounts.rows.map((a) => (archivedAccounts.includes(a.id) ? { ...a, archivedAt: now } : a));
  const deps: AccountsDeps = {
    accounts,
    access: fakeSpaceAccess(
      where === "ana"
        ? membership({ archived })
        : membership({ spaceId: "space-household", name: "Household", spaceKind: "SHARED", archived }),
    ),
    movements: new FixedMovements(),
    ids: sequentialIds("acc"),
    clock: new FixedClock(now),
    userTimeZones: fixedTimeZones(),
    tm: memoryTm,
  };
  return {
    accounts,
    create: createCreateAccount(deps),
    update: createUpdateAccount(deps),
    archive: createArchiveAccount(deps),
    restore: createRestoreAccount(deps),
    list: createListAccounts(deps),
    get: createGetAccount(deps),
  };
};
type World = ReturnType<typeof world>;

const WRITES: readonly (readonly [
  name: string,
  where: "ana" | "household",
  write: (w: World) => Promise<Result<unknown>>,
  archivedAccounts?: readonly string[],
])[] = [
  [
    "CreateAccount",
    "ana",
    (w) => w.create({ ...ana, name: "Nequi", type: "CASH", openingBalance: money(0n) }),
  ],
  [
    "CreateAccount for a shared fund",
    "household",
    (w) => w.create({ ...household, name: "Trip Fund", type: "SHARED_FUND", openingBalance: money(0n) }),
  ],
  [
    "UpdateAccount",
    "ana",
    (w) => w.update({ ...ana, accountId: "acc-bancolombia", changes: { name: "Bancolombia Ahorros" } }),
  ],
  [
    "UpdateAccount of a shared fund",
    "household",
    (w) => w.update({ ...household, accountId: "acc-fund", changes: { name: "Casa Fund" } }),
  ],
  ["ArchiveAccount", "ana", (w) => w.archive({ ...ana, accountId: "acc-bancolombia" })],
  ["ArchiveAccount of a shared fund", "household", (w) => w.archive({ ...household, accountId: "acc-fund" })],
  // Restore needs an archived account, or an active space would only run its no-op path.
  ["RestoreAccount", "ana", (w) => w.restore({ ...ana, accountId: "acc-bancolombia" }), ["acc-bancolombia"]],
  [
    "RestoreAccount of a shared fund",
    "household",
    (w) => w.restore({ ...household, accountId: "acc-fund" }),
    ["acc-fund"],
  ],
];

describe("archived spaces only read: accounts (HU-E1-09, Review Focus 4)", () => {
  it.each(
    WRITES.map(
      ([name, where, write, archivedAccounts = []]) => [name, where, write, archivedAccounts] as const,
    ),
  )(
    "%s answers SpaceArchived, where an active space accepts it",
    async (_name, where, write, archivedAccounts) => {
      expect(codeOf(await write(world(where, false, archivedAccounts)))).toBe("ok");
      const archived = world(where, true, archivedAccounts);
      const before = [...archived.accounts.rows];
      expect(codeOf(await write(archived))).toBe("SpaceArchived");
      expect(archived.accounts.rows).toEqual(before);
    },
  );

  it("still lists its accounts, archived ones on request, and reads each one", async () => {
    const w = world("ana", true);
    expect(unwrap(await w.list({ ...ana, includeArchived: false })).items.map((a) => a.id)).toEqual([
      "acc-bancolombia",
    ]);
    expect(unwrap(await w.get({ ...ana, accountId: "acc-bancolombia" }))).toMatchObject({
      name: "Bancolombia",
      balance: 200_000_000n,
    });
  });
});
