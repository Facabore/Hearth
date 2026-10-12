import { eq, sql } from "drizzle-orm";
import { bigint, pgTable, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabase } from "../../../../tests/support/database";

const moneyProbe = pgTable("money_probe", {
  id: uuid("id").primaryKey().defaultRandom(),
  amount: bigint("amount", { mode: "bigint" }).notNull(),
});
const { db, pool } = testDatabase();

beforeAll(() =>
  db.execute(
    sql`CREATE TABLE IF NOT EXISTS money_probe (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), amount bigint NOT NULL)`,
  ),
);
afterAll(() => pool.end());

describe("bigint money columns", () => {
  it.each([160000000n, -1250n, 9007199254740993n])(
    "save and reload %s minor units exactly",
    async (amount) => {
      const [saved] = await db.insert(moneyProbe).values({ amount }).returning();
      const [reloaded] = await db.select().from(moneyProbe).where(eq(moneyProbe.id, saved!.id));
      expect(typeof reloaded!.amount).toBe("bigint");
      expect(reloaded!.amount).toBe(amount);
    },
  );
});
