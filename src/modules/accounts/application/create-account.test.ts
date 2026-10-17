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
import { createCreateAccount } from "./create-account";
import type { AccountsDeps } from "./deps";

const asAna = { spaceId: "space-ana", userId: "u-ana" };
const household = membership({ spaceId: "space-household", spaceKind: "SHARED", name: "Household" });
const sofi = membership({ ...household, memberId: "member-sofi", userId: "u-sofi", role: "VIEWER" });

const setup = () => {
  const accounts = new InMemoryAccounts();
  const deps: AccountsDeps = {
    accounts,
    access: fakeSpaceAccess(membership(), household, sofi),
    movements: new FixedMovements(),
    ids: sequentialIds("acc"),
    clock: new FixedClock(new Date("2026-10-12T12:00:00Z")),
    userTimeZones: fixedTimeZones(),
    tm: memoryTm,
  };
  return { accounts, create: createCreateAccount(deps) };
};

describe("CreateAccount (HU-E2-01)", () => {
  it("creates a bank account in her personal space, owned by her", async () => {
    const { accounts, create } = setup();
    const view = unwrap(
      await create({ ...asAna, name: "Bancolombia", type: "BANK", openingBalance: money(200_000_000n) }),
    );
    expect(view).toMatchObject({
      spaceId: "space-ana",
      ownerUserId: "u-ana",
      type: "BANK",
      openingBalance: 200_000_000n,
      balance: 200_000_000n,
      currency: "COP",
    });
    expect(accounts.rows).toHaveLength(1);
  });

  it("keeps the common attributes it is given (HU-E2-05)", async () => {
    const { accounts, create } = setup();
    const view = unwrap(
      await create({
        ...asAna,
        name: "Nequi",
        type: "WALLET",
        openingBalance: money(0n),
        attributes: { institution: "Nequi", lastFour: "4821", color: "pine", icon: "wallet" },
      }),
    );
    const expected = {
      type: "WALLET",
      institution: "Nequi",
      lastFour: "4821",
      color: "pine",
      icon: "wallet",
    };
    expect(view).toMatchObject(expected);
    expect(accounts.rows[0]).toMatchObject(expected);
  });

  it("creates a credit card with a negative opening balance", async () => {
    const { create } = setup();
    const view = unwrap(
      await create({ ...asAna, name: "Visa", type: "CREDIT_CARD", openingBalance: money(-35_000_000n) }),
    );
    expect(view.openingBalance).toBe(-35_000_000n);
  });

  it("rejects a duplicate name in the same space ignoring case", async () => {
    const { create } = setup();
    unwrap(await create({ ...asAna, name: "Bancolombia", type: "BANK", openingBalance: money(0n) }));
    const again = await create({ ...asAna, name: "bancolombia", type: "SAVINGS", openingBalance: money(0n) });
    expect(codeOf(again)).toBe("AccountNameTaken");
  });

  it("rejects a shared fund in a personal space", async () => {
    const { create } = setup();
    const result = await create({ ...asAna, name: "Fund", type: "SHARED_FUND", openingBalance: money(0n) });
    expect(codeOf(result)).toBe("SharedFundRequiresSharedSpace");
  });

  it("rejects personal account types in a shared space", async () => {
    const { create } = setup();
    const result = await create({
      spaceId: "space-household",
      userId: "u-ana",
      name: "Bancolombia",
      type: "BANK",
      openingBalance: money(0n),
    });
    expect(codeOf(result)).toBe("PersonalAccountRequiresPersonalSpace");
  });

  it("rejects an opening balance in another currency", async () => {
    const { create } = setup();
    const result = await create({
      ...asAna,
      name: "Chase",
      type: "BANK",
      openingBalance: money(10_000n, "USD"),
    });
    expect(codeOf(result)).toBe("CurrencyMismatch");
  });

  it("forbids viewers and hides other spaces", async () => {
    const { create } = setup();
    const input = { name: "Fund", type: "SHARED_FUND" as const, openingBalance: money(0n) };
    expect(codeOf(await create({ ...input, spaceId: "space-household", userId: "u-sofi" }))).toBe(
      "InsufficientRole",
    );
    expect(codeOf(await create({ ...input, spaceId: "space-ana", userId: "u-luis" }))).toBe("SpaceNotFound");
  });
});
