import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createSeedDefaultCategories } from "@/modules/categories/application";
import { DrizzleCategoryRepository } from "@/modules/categories/infrastructure/drizzle-category-repository";
import {
  createCreatePersonalSpace,
  createSpaceAccess,
  type SpaceCreatedListener,
} from "@/modules/spaces/application";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { FixedClock, map } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { fixedTimeZones, unwrap } from "../../../../tests/support/fakes";
import { personalSpaceFixture } from "../../../../tests/support/fixtures";
import { bothSettled, heldBy, holder } from "../../../../tests/support/locks";
import { FixedMovements } from "../../../../tests/support/in-memory-accounts";
import type { Account, AccountRepository } from "../application";
import { createSeedStarterAccounts } from "../application/seed-starter-accounts";
import { DrizzleAccountRepository } from "./drizzle-account-repository";

const { db, pool } = testDatabase();
afterAll(() => pool.end());

const tm = new DrizzleTransactionManager(db);
const ids = new UuidV7IdGenerator();
const clock = new FixedClock(new Date("2026-10-22T12:00:00Z"));
const spaces = new DrizzleSpaceRepository(tm);

/** The real accounts store with `afterInsert` called after each insert, whichever insert the caller uses. */
const hookedAccounts = (afterInsert: (account: Account) => Promise<void>): AccountRepository => {
  const real = new DrizzleAccountRepository(tm);
  return {
    listBySpace: (spaceId) => real.listBySpace(spaceId),
    findById: (accountId) => real.findById(accountId),
    save: (account) => real.save(account),
    add: async (account: Account) => {
      await real.add(account);
      await afterInsert(account);
    },
    addUnlessNameTaken: async (account: Account) => {
      const added = await real.addUnlessNameTaken(account);
      await afterInsert(account);
      return added;
    },
  };
};

/** The real accounts store, failing after its `failAt`-th insert as a database error would. */
const accountsFailingAt = (failAt: number): AccountRepository => {
  let added = 0;
  return hookedAccounts(async () => {
    if (++added === failAt) throw new Error("simulated database error");
  });
};

const starterDeps = (accounts: AccountRepository) => ({
  accounts,
  access: createSpaceAccess(spaces),
  movements: new FixedMovements(),
  ids,
  clock,
  userTimeZones: fixedTimeZones(),
  tm,
});

/** Sign-up's personal space, composed as the container composes it: categories, then starter accounts (issue 169). */
const personalSpaceWith = (accounts: AccountRepository, seen: string[]) => {
  const seedCategories = createSeedDefaultCategories({
    categories: new DrizzleCategoryRepository(tm),
    ids,
    clock,
    tm,
  });
  const seedStarter = createSeedStarterAccounts(starterDeps(accounts));
  const onCreated: SpaceCreatedListener = async (space, { locale }) => {
    seen.push(space.id);
    const seeded = await seedCategories({ spaceId: space.id, locale });
    if (!seeded.ok) return seeded;
    return map(
      await seedStarter({ spaceId: space.id, userId: space.personalOwnerUserId!, locale }),
      () => undefined,
    );
  };
  return createCreatePersonalSpace({ spaces, ids, clock, tm, onCreated });
};

const newUser = async () => {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [
    userId,
    "Ana",
    `${userId}@example.com`,
  ]);
  return userId;
};
const count = async (sql: string, value: string) => Number((await pool.query(sql, [value])).rows[0].n);

describe("starter accounts in the personal space's transaction (issue 169)", () => {
  it("stores the five starter accounts with the space and its categories", async () => {
    const userId = await newUser();
    const seen: string[] = [];
    const created = await personalSpaceWith(
      new DrizzleAccountRepository(tm),
      seen,
    )({
      userId,
      name: "Ana",
      locale: "es",
    });
    expect(created.ok).toBe(true);
    const names = await pool.query("SELECT name FROM accounts WHERE space_id = $1 ORDER BY name", [seen[0]]);
    expect(names.rows.map((r) => r.name)).toEqual([
      "Ahorros",
      "Billetera digital",
      "Cuenta bancaria",
      "Efectivo",
      "Tarjeta de crédito",
    ]);
  });

  it("rolls the space and its categories back when a starter account cannot be stored", async () => {
    const userId = await newUser();
    const seen: string[] = [];
    await expect(
      personalSpaceWith(accountsFailingAt(3), seen)({ userId, name: "Ana", locale: "es" }),
    ).rejects.toThrow("simulated database error");
    const [spaceId] = seen;
    expect(spaceId).toEqual(expect.any(String));
    expect(await spaces.hasPersonalSpace(userId)).toBe(false);
    expect(await count("SELECT count(*) AS n FROM spaces WHERE id = $1", spaceId!)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM category_groups WHERE space_id = $1", spaceId!)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM categories WHERE space_id = $1", spaceId!)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM accounts WHERE owner_user_id = $1", userId)).toBe(0);
  });
});

describe("two starter calls at once (issue 169)", () => {
  it("lets the second skip a starter the first is inserting, instead of failing on accounts_space_name_uq", async () => {
    const space = await personalSpaceFixture(db, pool);
    const input = { spaceId: space.spaceId, userId: space.userId, locale: "es" };
    const h = holder(tm, pool);
    let holding = true;
    // The first call stops right after inserting "Efectivo", its transaction open, until the second queues behind it.
    const first = createSeedStarterAccounts(
      starterDeps(
        hookedAccounts(async () => {
          if (!holding) return;
          holding = false;
          await h.hold();
        }),
      ),
    )(input);
    await heldBy(h, first);
    const second = createSeedStarterAccounts(starterDeps(new DrizzleAccountRepository(tm)))(input).finally(
      h.release,
    );
    const [a, b] = await bothSettled(first, second);
    expect(unwrap(a).map((account) => account.name)).toEqual([
      "Efectivo",
      "Cuenta bancaria",
      "Billetera digital",
      "Tarjeta de crédito",
      "Ahorros",
    ]);
    expect(unwrap(b)).toEqual([]);
    expect(await count("SELECT count(*) AS n FROM accounts WHERE space_id = $1", space.spaceId)).toBe(5);
  });
});
