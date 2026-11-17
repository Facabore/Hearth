import { describe, expect, it } from "vitest";
import { FixedClock, type LocalDate } from "@/shared/kernel";
import { fixedTimeZones, unwrap } from "../../../../tests/support/fakes";
import { createGetAccountUsage, type AccountUse, type CategoryAccount } from "./get-account-usage";

const on = (date: string) => date as LocalDate;

const usageOf = (accounts: AccountUse[], categories: CategoryAccount[] = []) => {
  const asked: { userId: string; from: LocalDate }[] = [];
  const getAccountUsage = createGetAccountUsage({
    // 2026-11-16 03:00 UTC is still 2026-11-15 in Bogotá.
    clock: new FixedClock(new Date("2026-11-16T03:00:00Z")),
    userTimeZones: fixedTimeZones({ "user-1": "America/Bogota" }),
    usage: {
      accountUsage: async (userId, from) => {
        asked.push({ userId, from });
        return { accounts, categories };
      },
    },
  });
  return { getAccountUsage, asked };
};

describe("getAccountUsage (ruling P337)", () => {
  it("counts the last 90 days of the caller's own time zone, today included", async () => {
    const { getAccountUsage, asked } = usageOf([]);

    const usage = unwrap(await getAccountUsage({ userId: "user-1" }));

    expect(asked).toEqual([{ userId: "user-1", from: "2026-08-18" }]);
    expect(usage.since).toBe("2026-08-18");
  });

  it("lists the most used account first, and the latest used one first on a tie", async () => {
    const { getAccountUsage } = usageOf([
      { accountId: "nequi", uses: 3, lastUsedOn: on("2026-11-01") },
      { accountId: "bancolombia", uses: 9, lastUsedOn: on("2026-10-20") },
      { accountId: "efectivo", uses: 3, lastUsedOn: on("2026-11-10") },
    ]);

    const usage = unwrap(await getAccountUsage({ userId: "user-1" }));

    expect(usage.accounts.map((a) => a.accountId)).toEqual(["bancolombia", "efectivo", "nequi"]);
  });

  it("answers the account each category was last paid from, as the movements say", async () => {
    const { getAccountUsage } = usageOf(
      [{ accountId: "bancolombia", uses: 1, lastUsedOn: on("2026-11-10") }],
      [{ categoryId: "gas", accountId: "bancolombia" }],
    );

    const usage = unwrap(await getAccountUsage({ userId: "user-1" }));

    expect(usage.categories).toEqual([{ categoryId: "gas", accountId: "bancolombia" }]);
  });
});
