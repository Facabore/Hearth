import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DirectSplitExpense } from "@/modules/ledger/contracts/ledger.contract";
import { localDate, Money } from "@/shared/kernel";
import { startTestApp } from "../../tests/support/app";
import { codeOf, unwrap } from "../../tests/support/fakes";
import { household } from "../../tests/support/ledger";
import { setContainerForTests, type Container } from "./container";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const pesos = (n: number) => unwrap(Money.ofMinor(BigInt(n * 100), "COP"));
const count = async (sql: string, params: unknown[]) =>
  (await app.pool.query(sql, params)).rows[0].n as number;
const directSpacesOf = (userId: string) =>
  count(
    `SELECT count(*)::int AS n FROM spaces s JOIN space_members m ON m.space_id = s.id
     WHERE s.kind = 'DIRECT' AND m.user_id = $1`,
    [userId],
  );
const transactionsOf = (userId: string) =>
  count("SELECT count(*)::int AS n FROM transactions WHERE created_by = $1", [userId]);

describe("SplitWithPeople over PostgreSQL, wired as the API runs it (P331)", () => {
  it("stores no part, no direct space and no personal expense when a later part is refused", async () => {
    const h = await household();
    const own: DirectSplitExpense = {
      description: "Cena",
      date: unwrap(localDate("2026-10-14")),
      amount: pesos(50_000),
      accountId: h.ana.account,
      categoryKey: "restaurants",
    };
    const part = (n: number, categoryKey = "restaurants"): DirectSplitExpense => ({
      ...own,
      amount: pesos(n),
      categoryKey,
      pairShares: { mine: pesos(0), theirs: pesos(n) },
    });
    const before = await transactionsOf(h.ana.userId);
    const result = await app.spaces.splitWithPeople({
      userId: h.ana.userId,
      userName: "Ana",
      locale: "es",
      people: [
        { counterpart: { memberId: h.juan.memberId }, expense: part(50_000) },
        // The guest's part names a category no direct space has, so the ledger refuses it after Juan's is recorded.
        { counterpart: { guest: { displayName: "Pedro" } }, expense: part(50_000, "no-such-key") },
      ],
      own,
    });
    expect(codeOf(result)).toBe("CategoryNotFound");
    expect(await directSpacesOf(h.ana.userId)).toBe(0);
    expect(await transactionsOf(h.ana.userId)).toBe(before);
  });
});
