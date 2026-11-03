import { afterAll, describe, expect, it } from "vitest";
import { createCreateAccount, type Account, type AccountsDeps } from "@/modules/accounts/application";
import { DrizzleAccountRepository } from "@/modules/accounts/infrastructure/drizzle-account-repository";
import { DrizzleBudgetPlanRepository } from "@/modules/budgeting/infrastructure/drizzle-budget-plan-repository";
import { DrizzleLedgerQueries } from "@/modules/ledger/infrastructure/drizzle-ledger-queries";
import { DrizzleRecurrenceRepository } from "@/modules/ledger/infrastructure/drizzle-recurrence-repository";
import {
  createSpaceAccess,
  createUpdateSpaceSettings,
  type SpaceSettingsChanges,
  type UpdateSpaceSettingsDeps,
} from "@/modules/spaces/application";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { FixedClock } from "@/shared/kernel";
import { testDatabase } from "../../tests/support/database";
import { fixedTimeZones, money } from "../../tests/support/fakes";
import { personalSpaceFixture, type SpaceFixture } from "../../tests/support/fixtures";
import { heldBy, holder, outcomesOf } from "../../tests/support/locks";
import { spaceUsageOf } from "./container";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const spaces = new DrizzleSpaceRepository(tm);
const accounts = new DrizzleAccountRepository(tm);
const clock = new FixedClock(new Date("2026-11-02T17:00:00Z"));

afterAll(() => pool.end());

type Holder = ReturnType<typeof holder>;

/** The real repository, but a creation stops in `h.hold()` once its account is inserted. */
class HoldingInsert extends DrizzleAccountRepository {
  constructor(private readonly h: Holder) {
    super(tm);
  }

  override async addUnlessNameTaken(account: Account): Promise<boolean> {
    const inserted = await super.addUnlessNameTaken(account);
    await this.h.hold();
    return inserted;
  }
}

const accountsDeps = (repository: DrizzleAccountRepository = accounts): AccountsDeps => ({
  accounts: repository,
  access: createSpaceAccess(spaces),
  spaceLocks: spaces,
  movements: new DrizzleLedgerQueries(tm),
  ids: new UuidV7IdGenerator(),
  clock,
  userTimeZones: fixedTimeZones(),
  tm,
});

/** The settings as the composition root builds them; the write stops in `h.hold()` once the settings are stored. */
const settingsOf = (h?: Holder) => {
  const deps: UpdateSpaceSettingsDeps = {
    spaces: {
      findMembership: (spaceId, userId) => spaces.findMembership(spaceId, userId),
      updateSettings: async (spaceId, settings) => {
        await spaces.updateSettings(spaceId, settings);
        await h?.hold();
      },
    },
    spaceLocks: spaces,
    access: createSpaceAccess(spaces),
    usage: spaceUsageOf({
      accounts,
      recurrences: new DrizzleRecurrenceRepository(tm),
      ledger: new DrizzleLedgerQueries(tm),
      plans: new DrizzleBudgetPlanRepository(tm),
    }),
    tm,
  };
  return createUpdateSpaceSettings(deps);
};

const changeSettings = (space: SpaceFixture, changes: SpaceSettingsChanges, h?: Holder) =>
  settingsOf(h)({ spaceId: space.spaceId, userId: space.userId, changes });

/** Ana opens "Davivienda" with 10,000 pesos in it. */
const openAccount = (space: SpaceFixture, deps = accountsDeps()) =>
  createCreateAccount(deps)({
    spaceId: space.spaceId,
    userId: space.userId,
    name: "Davivienda",
    type: "BANK",
    openingBalance: money(1_000_000n, "COP"),
  });

const currencyOf = async (spaceId: string): Promise<string> =>
  (await pool.query("SELECT currency FROM spaces WHERE id = $1", [spaceId])).rows[0].currency as string;

const accountNamesIn = async (spaceId: string): Promise<string[]> =>
  (await pool.query("SELECT name FROM accounts WHERE space_id = $1 ORDER BY name", [spaceId])).rows.map(
    (r) => r.name as string,
  );

describe("space settings against a new account (#245, M1-2)", () => {
  it("answers SpaceCurrencyLocked to a currency change that waited for an account with money to commit", async () => {
    const ana = await personalSpaceFixture(db, pool, "Ana");
    const h = holder(tm, pool);
    const opening = openAccount(ana, accountsDeps(new HoldingInsert(h)));
    await heldBy(h, opening);
    const changing = changeSettings(ana, { currency: "USD" }).finally(h.release);
    expect(await outcomesOf(opening, changing)).toEqual(["SpaceCurrencyLocked", "ok"]);
    expect(await currencyOf(ana.spaceId)).toBe("COP");
  });

  it("answers CurrencyMismatch to an account that waited for a currency change to commit", async () => {
    const ana = await personalSpaceFixture(db, pool, "Ana");
    const h = holder(tm, pool);
    const changing = changeSettings(ana, { currency: "USD" }, h);
    await heldBy(h, changing);
    const opening = openAccount(ana).finally(h.release);
    expect(await outcomesOf(changing, opening)).toEqual(["CurrencyMismatch", "ok"]);
    expect(await currencyOf(ana.spaceId)).toBe("USD");
    expect(await accountNamesIn(ana.spaceId)).toEqual([]);
  });
});
