import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { domainError, err, ok } from "@/shared/kernel";
import { testDatabase } from "../../../../tests/support/database";
import { DrizzleTransactionManager } from "./drizzle-transaction-manager";

const { db, pool } = testDatabase();
const tm = new DrizzleTransactionManager(db);
const count = async () => {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM tm_probe");
  return rows[0].n as number;
};
const insert = (id: number) => tm.executor().execute(sql`INSERT INTO tm_probe (id) VALUES (${id})`);

beforeAll(() => db.execute(sql`CREATE TABLE IF NOT EXISTS tm_probe (id int PRIMARY KEY)`));
beforeEach(() => db.execute(sql`TRUNCATE tm_probe`));
afterAll(() => pool.end());

describe("DrizzleTransactionManager", () => {
  it("commits when the work succeeds", async () => {
    const result = await tm.run(async () => {
      await insert(1);
      await insert(2);
      return ok("done");
    });
    expect(result).toEqual(ok("done"));
    expect(await count()).toBe(2);
  });

  it("rolls back every write when the work returns an Err, and returns that Err", async () => {
    const failure = err(domainError("Boom", { reason: "test" }));
    const result = await tm.run(async () => {
      await insert(1);
      await insert(2);
      return failure;
    });
    expect(result).toEqual(failure);
    expect(await count()).toBe(0);
  });

  it("rolls back and rethrows when the work throws", async () => {
    await expect(
      tm.run(async () => {
        await insert(1);
        throw new Error("crash");
      }),
    ).rejects.toThrow("crash");
    expect(await count()).toBe(0);
  });

  it("joins the outer transaction when nested", async () => {
    const result = await tm.run(async () => {
      await insert(1);
      const inner = await tm.run(async () => {
        await insert(2);
        return ok(null);
      });
      expect(inner).toEqual(ok(null));
      return err(domainError("OuterFails"));
    });
    expect(result.ok).toBe(false);
    expect(await count()).toBe(0);
  });

  it("writes outside run() go straight to the database", async () => {
    await insert(7);
    expect(await count()).toBe(1);
  });

  it("isolates concurrent transactions from each other", async () => {
    const [committed, rolledBack] = await Promise.all([
      tm.run(async () => {
        await insert(1);
        return ok("a");
      }),
      tm.run(async () => {
        await insert(2);
        return err(domainError("B"));
      }),
    ]);
    expect(committed.ok && !rolledBack.ok).toBe(true);
    const { rows } = await pool.query("SELECT id FROM tm_probe");
    expect(rows).toEqual([{ id: 1 }]);
  });
});
