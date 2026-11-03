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
  noSpaceLocks,
} from "../../../../tests/support/fakes";
import { FixedMovements, InMemoryAccounts } from "../../../../tests/support/in-memory-accounts";
import { createArchiveAccount } from "./archive-account";
import { createCreateAccount } from "./create-account";
import type { AccountsDeps } from "./deps";
import { createRestoreAccount } from "./restore-account";
import { createUpdateAccount } from "./update-account";

// Background: "Ana" is OWNER and "Juan" is MEMBER of the shared space "Household"; "Lina" is its ADMIN, "Sofi" its VIEWER.
const household = membership({ spaceId: "space-household", spaceKind: "SHARED", name: "Household" });
const juan = membership({ ...household, memberId: "member-juan", userId: "u-juan", role: "MEMBER" });
const lina = membership({ ...household, memberId: "member-lina", userId: "u-lina", role: "ADMIN" });
const sofi = membership({ ...household, memberId: "member-sofi", userId: "u-sofi", role: "VIEWER" });
const asAna = { spaceId: "space-household", userId: "u-ana" };
const asJuan = { spaceId: "space-household", userId: "u-juan" };
const asLina = { spaceId: "space-household", userId: "u-lina" };
const asSofi = { spaceId: "space-household", userId: "u-sofi" };
const fund = { name: "Household Fund", type: "SHARED_FUND" as const, openingBalance: money(0n) };

const setup = () => {
  const accounts = new InMemoryAccounts();
  const deps: AccountsDeps = {
    spaceLocks: noSpaceLocks,
    accounts,
    access: fakeSpaceAccess(household, juan, lina, sofi),
    movements: new FixedMovements(),
    ids: sequentialIds("acc"),
    clock: new FixedClock(new Date("2026-10-13T12:00:00Z")),
    userTimeZones: fixedTimeZones(),
    tm: memoryTm,
  };
  return {
    accounts,
    create: createCreateAccount(deps),
    update: createUpdateAccount(deps),
    archive: createArchiveAccount(deps),
    restore: createRestoreAccount(deps),
  };
};

describe("shared fund account (HU-E2-02)", () => {
  it("lets the owner create the household fund in the shared space with no owner user", async () => {
    const { create } = setup();
    expect(unwrap(await create({ ...asAna, ...fund }))).toMatchObject({
      spaceId: "space-household",
      name: "Household Fund",
      type: "SHARED_FUND",
      ownerUserId: null,
      openingBalance: 0n,
      balance: 0n,
    });
  });

  it("lets an admin create and rename a shared fund", async () => {
    const { create, update } = setup();
    const created = unwrap(await create({ ...asLina, ...fund }));
    expect(created).toMatchObject({ type: "SHARED_FUND", ownerUserId: null });
    expect(unwrap(await update({ ...asLina, accountId: created.id, changes: { name: "Pot" } })).name).toBe(
      "Pot",
    );
  });

  it("does not let a member create a shared fund", async () => {
    const { create, accounts } = setup();
    expect(codeOf(await create({ ...asJuan, ...fund }))).toBe("InsufficientRole");
    expect(accounts.rows).toEqual([]);
  });

  it("keeps personal account types out of the shared space for owners and members", async () => {
    const { create } = setup();
    for (const actor of [asAna, asJuan]) {
      const result = await create({ ...actor, name: "Bancolombia", type: "BANK", openingBalance: money(0n) });
      expect(codeOf(result)).toBe("PersonalAccountRequiresPersonalSpace");
    }
  });

  it("lets only owners and admins rename or archive the fund", async () => {
    const { create, update, archive } = setup();
    const created = unwrap(await create({ ...asAna, ...fund }));
    expect(codeOf(await update({ ...asJuan, accountId: created.id, changes: { name: "Pot" } }))).toBe(
      "InsufficientRole",
    );
    expect(codeOf(await archive({ ...asJuan, accountId: created.id }))).toBe("InsufficientRole");
    expect(unwrap(await update({ ...asAna, accountId: created.id, changes: { name: "Pot" } })).name).toBe(
      "Pot",
    );
  });

  it("lets an ADMIN archive the fund", async () => {
    const { create, archive, accounts } = setup();
    const created = unwrap(await create({ ...asAna, ...fund }));
    const archived = unwrap(await archive({ ...asLina, accountId: created.id }));
    expect(archived.archivedAt).toEqual(new Date("2026-10-13T12:00:00Z"));
    expect((await accounts.findById(created.id))?.archivedAt).toEqual(new Date("2026-10-13T12:00:00Z"));
  });

  it("refuses a VIEWER every fund write and changes nothing", async () => {
    const { create, update, archive, restore, accounts } = setup();
    const created = unwrap(await create({ ...asAna, ...fund }));
    expect(codeOf(await create({ ...asSofi, ...fund, name: "Pot" }))).toBe("InsufficientRole");
    expect(codeOf(await update({ ...asSofi, accountId: created.id, changes: { name: "Pot" } }))).toBe(
      "InsufficientRole",
    );
    expect(codeOf(await archive({ ...asSofi, accountId: created.id }))).toBe("InsufficientRole");
    unwrap(await archive({ ...asAna, accountId: created.id }));
    expect(codeOf(await restore({ ...asSofi, accountId: created.id }))).toBe("InsufficientRole");
    expect(await accounts.findById(created.id)).toMatchObject({
      name: "Household Fund",
      archivedAt: expect.any(Date),
    });
  });

  it("lets whoever may archive the fund restore it, and keeps members out (ruling P123)", async () => {
    const { create, archive, restore } = setup();
    const created = unwrap(await create({ ...asAna, ...fund }));
    await archive({ ...asLina, accountId: created.id });
    expect(codeOf(await restore({ ...asJuan, accountId: created.id }))).toBe("InsufficientRole");
    expect(unwrap(await restore({ ...asLina, accountId: created.id })).archivedAt).toBeNull();
  });
});
