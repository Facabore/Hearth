import { describe, expect, it } from "vitest";
import { activityItemDto, cop, transactionDto } from "../../../../../tests/support/ui/dto";
import type { UnifiedViewDto } from "@/shared/ui/api/dto";
import { mergedFeed, unifiedMonthOf } from "./feed";

const own = (
  id: string,
  date: string,
  occurredAt: string | null = null,
  createdAt = `${date}T12:00:00.000Z`,
) => transactionDto({ id, date, occurredAt, createdAt });
const group = (
  id: string,
  date: string,
  occurredAt: string | null = null,
  createdAt = `${date}T12:00:00.000Z`,
) => activityItemDto({ transaction: transactionDto({ id, date, occurredAt, createdAt }) });

const idsOf = (entries: ReturnType<typeof mergedFeed>) =>
  entries.map((entry) => (entry.kind === "own" ? entry.tx.id : `g:${entry.item.transaction.id}`));

describe("mergedFeed (ruling P306)", () => {
  it("merges her rows with her spaces' in Movimientos' order: the date, then the time, creation and id", () => {
    const feed = mergedFeed(
      [own("mine-late", "2026-11-06", "2026-11-06T20:00:00.000Z"), own("mine-old", "2026-11-01")],
      [
        group("hogar-early", "2026-11-06", "2026-11-06T09:00:00.000Z"),
        group("viaje", "2026-11-03"),
        group("untimed", "2026-11-06"),
      ],
      10,
    );
    expect(idsOf(feed)).toEqual(["mine-late", "g:hogar-early", "g:untimed", "g:viaje", "mine-old"]);
  });

  it("keeps the newest `limit` of both lists", () => {
    const feed = mergedFeed([own("a", "2026-11-05"), own("b", "2026-11-02")], [group("c", "2026-11-04")], 2);
    expect(idsOf(feed)).toEqual(["a", "g:c"]);
  });
});

const view = (bySpace?: UnifiedViewDto["bySpace"]) =>
  ({
    currency: "COP",
    consumption: { total: cop(725_000), categories: [] },
    bySpace,
  }) as unknown as UnifiedViewDto;

describe("unifiedMonthOf (ruling P306)", () => {
  it("takes her share from the consumption and what she paid from the sum per space", () => {
    const month = unifiedMonthOf(
      view([
        {
          space: { id: "p", name: "Personal", kind: "PERSONAL", color: "PINE" },
          consumed: cop(245_000),
          paid: cop(245_000),
        },
        {
          space: { id: "h", name: "Hogar", kind: "SHARED", color: "SKY" },
          consumed: cop(480_000),
          paid: cop(810_000),
        },
      ]),
      "/mi-consumo",
    );
    expect(month.consumed).toEqual(cop(725_000));
    expect(month.paid).toEqual(cop(1_055_000));
    expect(month.bySpace.map((s) => [s.name, s.color])).toEqual([
      ["Personal", "PINE"],
      ["Hogar", "SKY"],
    ]);
    expect(month.href).toBe("/mi-consumo");
  });

  it("breaks nothing down for an API without bySpace", () => {
    const month = unifiedMonthOf(view(undefined), "/mi-consumo");
    expect(month.bySpace).toEqual([]);
    expect(month.paid).toEqual(cop(0));
  });
});
