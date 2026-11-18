import { describe, expect, it } from "vitest";
import type { SpaceSummary } from "@/modules/spaces/application";
import { FixedClock } from "@/shared/kernel";
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
import { createListMyAccounts } from "./list-my-accounts";

const now = new Date("2026-10-12T12:00:00Z");
const account = (id: string, spaceId: string, name: string, overrides: Partial<Account> = {}): Account => ({
  id: id as AccountId,
  spaceId,
  name,
  type: "BANK",
  ownerUserId: "u-ana",
  currency: "COP",
  openingBalance: 100_000n,
  archivedAt: null,
  createdAt: now,
  ...NO_ATTRIBUTES,
  ...overrides,
});

const summary = (id: string, kind: SpaceSummary["kind"]): SpaceSummary => ({
  id,
  name: id,
  kind,
  currency: "COP",
  periodPolicy: { kind: "MONTHLY", day: 1 },
  role: "OWNER",
  color: "GRAPHITE",
});

/**
 * Ana's personal space and a household she belongs to; `space-gone` is listed for her but no longer lets her in (the
 * per-space read refuses it), so it is left out.
 */
const setup = () => {
  const accounts = new InMemoryAccounts();
  accounts.rows.push(
    account("acc-nequi", "space-ana", "Nequi"),
    account("acc-bancolombia", "space-ana", "Bancolombia"),
    account("acc-old", "space-ana", "Vieja", { archivedAt: new Date("2026-10-01T12:00:00Z") }),
    account("acc-fund", "space-household", "Fondo", { type: "SHARED_FUND" }),
    account("acc-gone", "space-gone", "Ajena"),
  );
  const listed: string[] = [];
  const listMine = createListMyAccounts({
    spaceLocks: noSpaceLocks,
    accounts,
    access: fakeSpaceAccess(
      membership(),
      membership({ spaceId: "space-household", memberId: "member-ana-h", spaceKind: "SHARED" }),
    ),
    movements: new FixedMovements({ "acc-nequi": 5_000n }),
    ids: sequentialIds("acc"),
    clock: new FixedClock(now),
    userTimeZones: fixedTimeZones(),
    tm: memoryTm,
    spaces: {
      listForUser: async (userId) => {
        listed.push(userId);
        return [
          summary("space-ana", "PERSONAL"),
          summary("space-household", "SHARED"),
          summary("space-gone", "SHARED"),
        ];
      },
    },
  });
  return { listMine, listed };
};

describe("ListMyAccounts (#338)", () => {
  it("gives each of the viewer's spaces its accounts by name with their balances, as the space's own list does, and leaves out one that refuses", async () => {
    const { listMine, listed } = setup();
    const mine = unwrap(await listMine({ userId: "u-ana", includeArchived: false }));
    expect(listed).toEqual(["u-ana"]);
    expect(mine.map((entry) => [entry.spaceId, entry.accounts.map((a) => a.id)])).toEqual([
      ["space-ana", ["acc-bancolombia", "acc-nequi"]],
      ["space-household", ["acc-fund"]],
    ]);
    expect(mine[0]!.accounts[1]!.balance).toBe(105_000n);
  });

  it("lists archived accounts only when asked", async () => {
    const { listMine } = setup();
    const ids = async (includeArchived: boolean) =>
      unwrap(await listMine({ userId: "u-ana", includeArchived }))[0]!.accounts.map((a) => a.id);
    expect(await ids(false)).not.toContain("acc-old");
    expect(await ids(true)).toContain("acc-old");
  });
});
