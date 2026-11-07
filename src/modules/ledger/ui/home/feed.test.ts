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
  it("splits her month into what she spent alone, by category, and her part of each group", () => {
    const month = unifiedMonthOf(
      view([
        {
          space: { id: "p", name: "Personal", kind: "PERSONAL", color: "PINE" },
          consumed: cop(245_000),
          paid: cop(245_000),
          categories: [
            { id: "c-market", name: "Mercado", color: "SAND", amount: cop(150_000) },
            { id: "c-food", name: "Restaurantes", color: null, amount: cop(95_000) },
          ],
        },
        {
          space: { id: "h", name: "Hogar", kind: "SHARED", color: "SKY" },
          consumed: cop(410_000),
          paid: cop(600_000),
        },
        {
          space: { id: "v", name: "Viaje", kind: "SHARED", color: "PLUM" },
          consumed: cop(70_000),
          paid: cop(210_000),
        },
        // A group where she only paid takes no part of her month.
        {
          space: { id: "f", name: "Finca", kind: "SHARED", color: "TEAL" },
          consumed: cop(0),
          paid: cop(50_000),
        },
      ]),
    );
    expect(month.consumed).toEqual(cop(725_000));
    expect(month.solo.amount).toEqual(cop(245_000));
    expect(month.solo.items.map((c) => [c.name, c.color])).toEqual([
      ["Mercado", "SAND"],
      ["Restaurantes", null],
    ]);
    expect(month.withOthers.amount).toEqual(cop(480_000));
    expect(month.withOthers.items.map((g) => [g.name, g.color, g.amount])).toEqual([
      ["Hogar", "SKY", cop(410_000)],
      ["Viaje", "PLUM", cop(70_000)],
    ]);
  });

  it("counts everything as hers alone for an API without bySpace", () => {
    const month = unifiedMonthOf(view(undefined));
    expect(month.solo).toEqual({ amount: cop(725_000), items: [] });
    expect(month.withOthers).toEqual({ amount: cop(0), items: [] });
  });
});
