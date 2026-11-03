import { afterAll, describe, expect, it } from "vitest";
import {
  createCreateAccount,
  createUpdateAccount,
  type Account,
  type AccountsDeps,
} from "@/modules/accounts/application";
import { DrizzleAccountRepository } from "@/modules/accounts/infrastructure/drizzle-account-repository";
import { DrizzleLedgerQueries } from "@/modules/ledger/infrastructure/drizzle-ledger-queries";
import { createSpaceAccess } from "@/modules/spaces/application";
import { DrizzleSpaceRepository } from "@/modules/spaces/infrastructure/drizzle-space-repository";
import { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { UuidV7IdGenerator } from "@/shared/infrastructure/uuid-v7-id-generator";
import { FixedClock } from "@/shared/kernel";
import { testDatabase } from "../../tests/support/database";
import { fixedTimeZones, money } from "../../tests/support/fakes";
import { accountFixture, personalSpaceFixture, type SpaceFixture } from "../../tests/support/fixtures";
import { heldBy, holder, outcomesOf } from "../../tests/support/locks";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const spaces = new DrizzleSpaceRepository(tm);
const clock = new FixedClock(new Date("2026-11-02T17:00:00Z"));

afterAll(() => pool.end());

type Holder = ReturnType<typeof holder>;

/** The real repository, but a save of `accountId` stops in `h.hold()` once it is written. */
class HoldingSave extends DrizzleAccountRepository {
  constructor(
    private readonly h: Holder,
    private readonly accountId: string,
  ) {
    super(tm);
  }

  override async save(account: Account): Promise<boolean> {
    const saved = await super.save(account);
    if (account.id === this.accountId) await this.h.hold();
    return saved;
  }
}

/** The accounts' deps over PostgreSQL as the composition root builds them; a test may hold `accounts`. */
const accountsDeps = (
  accounts: DrizzleAccountRepository = new DrizzleAccountRepository(tm),
): AccountsDeps => ({
  accounts,
  access: createSpaceAccess(spaces),
  movements: new DrizzleLedgerQueries(tm),
  ids: new UuidV7IdGenerator(),
  clock,
  userTimeZones: fixedTimeZones(),
  tm,
});

const rename = (space: SpaceFixture, accountId: string, name: string, deps = accountsDeps()) =>
  createUpdateAccount(deps)({ spaceId: space.spaceId, userId: space.userId, accountId, changes: { name } });

/** The names the space's accounts have, sorted. */
const namesIn = async (spaceId: string): Promise<string[]> =>
  (await pool.query("SELECT name FROM accounts WHERE space_id = $1 ORDER BY name", [spaceId])).rows.map(
    (r) => r.name as string,
  );

describe("account names against concurrent writes (#245, M1-1)", () => {
  it("answers AccountNameTaken to a rename that loses the race for a name, never a 500", async () => {
    const ana = await personalSpaceFixture(db, pool, "Ana");
    const bank = await accountFixture(db, ana, "Bancolombia");
    const wallet = await accountFixture(db, ana, "Nequi");
    const h = holder(tm, pool);
    const first = rename(ana, bank, "Davivienda", accountsDeps(new HoldingSave(h, bank)));
    // The first rename is written, not committed: the second one reads the old name and passes the domain check.
    await heldBy(h, first);
    const second = rename(ana, wallet, "davivienda").finally(h.release);
    expect(await outcomesOf(first, second)).toEqual(["AccountNameTaken", "ok"]);
    expect(await namesIn(ana.spaceId)).toEqual(["Davivienda", "Nequi"]);
  });

  it("answers AccountNameTaken to a creation that loses the race to a rename, never a 500", async () => {
    const ana = await personalSpaceFixture(db, pool, "Ana");
    const bank = await accountFixture(db, ana, "Bancolombia");
    const h = holder(tm, pool);
    const renaming = rename(ana, bank, "Davivienda", accountsDeps(new HoldingSave(h, bank)));
    await heldBy(h, renaming);
    const creating = createCreateAccount(accountsDeps())({
      spaceId: ana.spaceId,
      userId: ana.userId,
      name: "Davivienda",
      type: "BANK",
      openingBalance: money(0n),
    }).finally(h.release);
    expect(await outcomesOf(renaming, creating)).toEqual(["AccountNameTaken", "ok"]);
    expect(await namesIn(ana.spaceId)).toEqual(["Davivienda"]);
  });
});
