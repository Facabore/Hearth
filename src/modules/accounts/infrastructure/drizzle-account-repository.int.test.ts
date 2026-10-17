import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { testDatabase } from "../../../../tests/support/database";
import { personalSpaceFixture, type SpaceFixture } from "../../../../tests/support/fixtures";
import { NO_ATTRIBUTES, type Account, type AccountId } from "../domain/account";
import { DrizzleAccountRepository } from "./drizzle-account-repository";

const { db, pool } = testDatabase();
const repo = new DrizzleAccountRepository(new DrizzleTransactionManager(db));
const account = (space: SpaceFixture, overrides: Partial<Account> = {}): Account => ({
  id: randomUUID() as AccountId,
  spaceId: space.spaceId,
  name: "Bancolombia",
  type: "BANK",
  ownerUserId: space.userId,
  openingBalance: 200_000_000n,
  archivedAt: null,
  createdAt: new Date("2026-10-12T12:00:00Z"),
  ...NO_ATTRIBUTES,
  ...overrides,
});

afterAll(() => pool.end());

describe("DrizzleAccountRepository", () => {
  it("stores, finds and lists accounts with exact bigint opening balances", async () => {
    const space = await personalSpaceFixture(db, pool);
    const bank = account(space);
    const card = account(space, { name: "Visa", type: "CREDIT_CARD", openingBalance: -35_000_000n });
    const huge = account(space, {
      name: "Huge",
      type: "SAVINGS",
      openingBalance: 9_223_372_036_854_775_807n,
    });
    for (const a of [bank, card, huge]) await repo.add(a);
    expect(await repo.findById(bank.id)).toEqual(bank);
    expect(await repo.findById(huge.id)).toEqual(huge);
    expect(await repo.listBySpace(space.spaceId)).toEqual(expect.arrayContaining([bank, card, huge]));
  });

  it("returns null for unknown and malformed ids", async () => {
    expect(await repo.findById(randomUUID())).toBeNull();
    expect(await repo.findById("not-a-uuid")).toBeNull();
  });

  it("saves name, opening balance and archive state", async () => {
    const space = await personalSpaceFixture(db, pool);
    const bank = account(space);
    await repo.add(bank);
    const archivedAt = new Date("2026-10-20T00:00:00Z");
    await repo.save({ ...bank, name: "Bancolombia Ahorros", openingBalance: 210_000_000n, archivedAt });
    expect(await repo.findById(bank.id)).toEqual({
      ...bank,
      name: "Bancolombia Ahorros",
      openingBalance: 210_000_000n,
      archivedAt,
    });
  });

  it("enforces unique names per space ignoring case, but not across spaces", async () => {
    const ana = await personalSpaceFixture(db, pool);
    const juan = await personalSpaceFixture(db, pool, "Juan");
    await repo.add(account(ana));
    await expect(repo.add(account(ana, { name: "BANCOLOMBIA" }))).rejects.toThrow();
    await expect(repo.add(account(juan))).resolves.toBeUndefined();
  });

  it("requires an owner for every account type except SHARED_FUND", async () => {
    const space = await personalSpaceFixture(db, pool);
    await expect(repo.add(account(space, { ownerUserId: null }))).rejects.toThrow();
  });
});

describe("account attributes (HU-E2-05)", () => {
  it("round-trips the new types and the common attributes, and refuses a full card number", async () => {
    const space = await personalSpaceFixture(db, pool);
    const wallet = account(space, {
      name: "Nequi",
      type: "WALLET",
      institution: "Nequi",
      lastFour: "4821",
      color: "pine",
      icon: "wallet",
    });
    await repo.add(wallet);
    expect(await repo.findById(wallet.id)).toEqual(wallet);
    await repo.save({ ...wallet, institution: null, lastFour: "1234", color: "ember", icon: null });
    expect(await repo.findById(wallet.id)).toMatchObject({
      institution: null,
      lastFour: "1234",
      color: "ember",
      icon: null,
    });
    await expect(
      pool.query(`UPDATE accounts SET last_four = '4111111111111111' WHERE id = $1`, [wallet.id]),
    ).rejects.toMatchObject({ constraint: "accounts_last_four" });
  });
});
