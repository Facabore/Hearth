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
import { NO_ATTRIBUTES, type Account, type AccountId } from "../domain/account";
import { createArchiveAccount } from "./archive-account";
import type { AccountsDeps } from "./deps";
import { createGetAccount, createListAccounts } from "./list-accounts";
import { createUpdateAccount } from "./update-account";

const now = new Date("2026-10-12T12:00:00Z");
const asAna = { spaceId: "space-ana", userId: "u-ana" };
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

const setup = (net: Record<string, bigint> = {}) => {
  const accounts = new InMemoryAccounts();
  accounts.rows.push(
    account("acc-bancolombia", "Bancolombia"),
    account("acc-nequi", "Nequi", { type: "CASH", openingBalance: 0n }),
    account("acc-davivienda", "Davivienda", { spaceId: "space-juan", ownerUserId: "u-juan" }),
  );
  const movements = new FixedMovements(net);
  const deps: AccountsDeps = {
    accounts,
    access: fakeSpaceAccess(membership()),
    movements,
    ids: sequentialIds("acc"),
    clock: new FixedClock(now),
    userTimeZones: fixedTimeZones(),
    tm: memoryTm,
  };
  return {
    accounts,
    movements,
    update: createUpdateAccount(deps),
    archive: createArchiveAccount(deps),
    list: createListAccounts(deps),
    get: createGetAccount(deps),
  };
};

describe("editing and archiving accounts (HU-E2-03)", () => {
  it("corrects the opening balance and recomputes the balance", async () => {
    const { update } = setup();
    const view = unwrap(
      await update({
        ...asAna,
        accountId: "acc-bancolombia",
        changes: { openingBalance: money(210_000_000n) },
      }),
    );
    expect(view).toMatchObject({ openingBalance: 210_000_000n, balance: 210_000_000n });
  });

  it("never changes the account type", async () => {
    const { update } = setup();
    const result = await update({ ...asAna, accountId: "acc-bancolombia", changes: { type: "SAVINGS" } });
    expect(codeOf(result)).toBe("AccountTypeImmutable");
  });

  it("changes and clears the common attributes (HU-E2-05)", async () => {
    const { update } = setup();
    const accountId = "acc-bancolombia";
    const changes = { attributes: { color: "PINE", lastFour: "4821" } } as const;
    expect(unwrap(await update({ ...asAna, accountId, changes }))).toMatchObject({
      color: "PINE",
      lastFour: "4821",
    });
    const cleared = unwrap(await update({ ...asAna, accountId, changes: { attributes: { color: null } } }));
    expect(cleared).toMatchObject({ color: null, lastFour: "4821" });
  });

  it("rejects renaming onto another account's name and foreign currencies", async () => {
    const { update } = setup();
    expect(codeOf(await update({ ...asAna, accountId: "acc-bancolombia", changes: { name: "nequi" } }))).toBe(
      "AccountNameTaken",
    );
    const usd = await update({
      ...asAna,
      accountId: "acc-bancolombia",
      changes: { openingBalance: money(1n, "USD") },
    });
    expect(codeOf(usd)).toBe("CurrencyMismatch");
  });

  it("archives an account, which leaves the active list but stays available", async () => {
    const { archive, list } = setup();
    expect(unwrap(await archive({ ...asAna, accountId: "acc-nequi" })).archivedAt).toEqual(now);
    const active = unwrap(await list({ ...asAna, includeArchived: false })).items;
    expect(active.map((a) => a.name)).toEqual(["Bancolombia"]);
    const all = unwrap(await list({ ...asAna, includeArchived: true })).items;
    expect(all.map((a) => a.name)).toEqual(["Bancolombia", "Nequi"]);
  });
});

describe("computed balances (HU-E2-04)", () => {
  it("adds net ledger movements to the opening balance", async () => {
    // income 3,000,000 - expense 85,000 - transfer 500,000 = +2,415,000 on Bancolombia; +500,000 on Nequi
    const { list } = setup({ "acc-bancolombia": 241_500_000n, "acc-nequi": 50_000_000n });
    const views = unwrap(await list({ ...asAna, includeArchived: false })).items;
    expect(views.map((v) => [v.name, v.balance])).toEqual([
      ["Bancolombia", 441_500_000n],
      ["Nequi", 50_000_000n],
    ]);
  });

  it("passes the as-of date to the ledger", async () => {
    const { get, movements } = setup();
    unwrap(await get({ ...asAna, accountId: "acc-bancolombia", asOf: "2026-10-31" as LocalDate }));
    expect(movements.asked).toEqual(["2026-10-31"]);
  });

  it("reports accounts outside the space as AccountNotFound", async () => {
    const { get, update } = setup();
    expect(codeOf(await get({ ...asAna, accountId: "acc-davivienda" }))).toBe("AccountNotFound");
    expect(codeOf(await update({ ...asAna, accountId: "acc-unknown", changes: { name: "X" } }))).toBe(
      "AccountNotFound",
    );
  });
});
