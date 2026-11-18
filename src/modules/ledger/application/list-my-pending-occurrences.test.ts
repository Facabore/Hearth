import { describe, expect, it } from "vitest";
import { unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES } from "../../../../tests/support/in-memory-ledger";
import { materializerWorld, rentDefinition } from "../../../../tests/support/in-memory-recurrences";
import { createListMyPendingOccurrences } from "./list-my-pending-occurrences";

/**
 * #338: Household's CONFIRM "Electricity" on the 10th and "Water" on the 3rd, and Ana's personal CONFIRM "Salary" on
 * the 5th, after the scheduler ran through 2026-12-10: every one of them waits for its real amount.
 */
const world = async () => {
  const w = materializerWorld();
  const confirm = { mode: "CONFIRM", startDate: rentDefinition().startDate } as const;
  await w.define(
    rentDefinition({ ...confirm, description: "Electricity", schedule: { kind: "MONTHLY", day: 10 } }),
  );
  await w.define(rentDefinition({ ...confirm, description: "Water", schedule: { kind: "MONTHLY", day: 3 } }));
  await w.define(
    rentDefinition({
      ...confirm,
      spaceId: "space-ana",
      description: "Salary",
      schedule: { kind: "MONTHLY", day: 5 },
      template: { type: "INCOME", categoryId: CATEGORIES.salary.id, accountId: ACCOUNTS.bancolombia.id },
    }),
  );
  await w.run("2026-12-10");
  return w;
};

const rows = (items: Awaited<ReturnType<ReturnType<typeof createListMyPendingOccurrences>>>) =>
  unwrap(items).map((p) => [p.spaceId, p.recurrence.description, p.occurrence.date]);

describe("the person's pending occurrences across her spaces (#338)", () => {
  it("lists every space's pending occurrences with the space, space by space, earliest first in each", async () => {
    const w = await world();
    const list = createListMyPendingOccurrences({ ...w.deps, spaces: w.spaces });

    expect(rows(await list("u-ana"))).toEqual([
      ["space-household", "Water", "2026-12-03"],
      ["space-household", "Electricity", "2026-12-10"],
      ["space-ana", "Salary", "2026-12-05"],
    ]);
    // Ruling P271: a VIEWER reads them too, and nobody reads another person's personal space.
    expect(rows(await list("u-sofi"))).toEqual([
      ["space-household", "Water", "2026-12-03"],
      ["space-household", "Electricity", "2026-12-10"],
    ]);
    expect(rows(await list("u-nobody"))).toEqual([]);
  });

  it("leaves out a space whose own read refuses the person, and still lists the others", async () => {
    const w = await world();
    const listed = await w.spaces.listForUser("u-ana");
    const list = createListMyPendingOccurrences({
      ...w.deps,
      // A space the list still names but the person no longer reads: its own read answers SpaceNotFound.
      spaces: { listForUser: async () => [{ ...listed[0]!, id: "space-gone" }, ...listed] },
    });

    expect(rows(await list("u-ana")).map(([spaceId]) => spaceId)).toEqual([
      "space-household",
      "space-household",
      "space-ana",
    ]);
  });
});
