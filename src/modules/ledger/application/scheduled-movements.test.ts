import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { unwrap } from "../../../../tests/support/fakes";
import { InMemoryRecurrences } from "../../../../tests/support/in-memory-recurrences";
import { pendingOccurrence, type OccurrenceId } from "../domain/occurrence";
import { defineRecurrence, type NewRecurrence, type RecurrenceId } from "../domain/recurrence";
import { createListScheduledMovements } from "./scheduled-movements";

const day = (iso: string) => iso as LocalDate;
const at = (iso: string) => new Date(`${iso}T17:00:00Z`);
const pesos = (n: number) => BigInt(n) * 100n;
const FROM_BANCOLOMBIA = { memberId: "member-ana", accountId: "acc-bancolombia" };

/** A recurrence of Household defined on 2026-10-28 in Bogotá. */
const recurrence = (id: string, overrides: Partial<NewRecurrence>) =>
  unwrap(
    defineRecurrence({
      id: id as RecurrenceId,
      spaceId: "space-household",
      description: "Rent",
      amount: pesos(1_200_000),
      currency: "COP",
      template: { type: "EXPENSE", categoryId: "cat-rent", payer: FROM_BANCOLOMBIA, split: null },
      schedule: { kind: "MONTHLY", day: 1 },
      mode: "AUTO",
      startDate: day("2026-11-01"),
      endDate: null,
      createdBy: "u-ana",
      now: at("2026-10-28"),
      today: day("2026-10-28"),
      ...overrides,
    }),
  );

const world = () => {
  const store = new InMemoryRecurrences();
  const list = createListScheduledMovements({ recurrences: store, occurrences: store });
  return { store, list };
};

describe("a space's scheduled movements (ruling P238 of M6c)", () => {
  it("lists its PENDING occurrences first, then every schedule date through the day, by date", async () => {
    const { store, list } = world();
    // Defined earlier, so it is listed first on a shared date; its October occurrence waits for a member.
    const power = {
      ...recurrence("rec-power", {
        description: "Electricity",
        amount: pesos(180_000),
        schedule: { kind: "MONTHLY", day: 20 },
        mode: "CONFIRM",
        startDate: day("2026-10-01"),
        now: at("2026-10-01"),
        today: day("2026-10-01"),
      }),
      dueFrom: day("2026-10-21"),
    };
    await store.add(power);
    await store.add(recurrence("rec-rent", {}));
    await store.add(
      recurrence("rec-salary", {
        description: "Salary",
        amount: pesos(3_000_000),
        template: { type: "INCOME", categoryId: "cat-salary", accountId: "acc-bancolombia" },
        schedule: { kind: "SEMI_MONTHLY", day1: 15, day2: 30 },
        startDate: day("2026-10-30"),
      }),
    );
    await store.addOccurrence(
      pendingOccurrence("occ-power-oct" as OccurrenceId, power, day("2026-10-20"), at("2026-10-20")),
    );
    const movements = await list({ spaceId: "space-household", through: day("2026-12-16") });
    expect(movements[0]).toEqual({
      recurrenceId: "rec-power",
      occurrenceId: "occ-power-oct",
      type: "EXPENSE",
      description: "Electricity",
      date: "2026-10-20",
      status: "PENDING",
      estimated: true,
      amount: pesos(180_000),
      currency: "COP",
      debitAccountId: "acc-bancolombia",
      creditAccountId: null,
    });
    expect(movements.map((m) => [m.description, m.date, m.status, m.estimated, m.creditAccountId])).toEqual([
      ["Electricity", "2026-10-20", "PENDING", true, null],
      ["Salary", "2026-10-30", "SCHEDULED", false, "acc-bancolombia"],
      ["Rent", "2026-11-01", "SCHEDULED", false, null],
      ["Salary", "2026-11-15", "SCHEDULED", false, "acc-bancolombia"],
      ["Electricity", "2026-11-20", "SCHEDULED", true, null],
      ["Salary", "2026-11-30", "SCHEDULED", false, "acc-bancolombia"],
      ["Rent", "2026-12-01", "SCHEDULED", false, null],
      ["Salary", "2026-12-15", "SCHEDULED", false, "acc-bancolombia"],
    ]);
  });

  it("lists no date of a paused or ended recurrence, keeps its pending occurrence, and reads only its own space", async () => {
    const { store, list } = world();
    const paused = { ...recurrence("rec-power", { mode: "CONFIRM" }), pausedAt: at("2026-10-29") };
    await store.add(paused);
    await store.add({ ...recurrence("rec-rent", {}), endedAt: at("2026-10-29") });
    await store.add(recurrence("rec-other", { spaceId: "space-other" }));
    await store.addOccurrence(
      pendingOccurrence("occ-1" as OccurrenceId, paused, day("2026-10-01"), at("2026-10-01")),
    );
    const movements = await list({ spaceId: "space-household", through: day("2026-12-31") });
    expect(movements.map((m) => [m.recurrenceId, m.status])).toEqual([["rec-power", "PENDING"]]);
  });

  it("lists a pending occurrence at its own estimate and a schedule date at the recurrence's amount, and skips an occurrence whose recurrence is unknown", async () => {
    const { store, list } = world();
    const power = {
      ...recurrence("rec-power", {
        amount: pesos(180_000),
        schedule: { kind: "MONTHLY", day: 20 },
        mode: "CONFIRM",
      }),
      dueFrom: day("2026-11-21"),
    };
    await store.add(power);
    await store.addOccurrence({
      ...pendingOccurrence("occ-power" as OccurrenceId, power, day("2026-11-20"), at("2026-11-20")),
      amount: pesos(195_000),
    });
    await store.addOccurrence({
      ...pendingOccurrence("occ-orphan" as OccurrenceId, power, day("2026-11-20"), at("2026-11-20")),
      recurrenceId: "rec-gone" as RecurrenceId,
    });
    const movements = await list({ spaceId: "space-household", through: day("2026-12-31") });
    expect(movements.map((m) => [m.occurrenceId, m.date, m.amount])).toEqual([
      ["occ-power", "2026-11-20", pesos(195_000)],
      [null, "2026-12-20", pesos(180_000)],
    ]);
  });

  it("places each item on its own local date and includes the last day of the window, at both ends of a Bogota day (ruling P246 of M6c)", async () => {
    const { store, list } = world();
    // The scheduler already considered 2027-03-15, so its next date is a month later.
    const filing = {
      ...recurrence("rec-filing", {
        description: "Tax filing",
        schedule: { kind: "MONTHLY", day: 15 },
        mode: "CONFIRM",
        startDate: day("2027-03-15"),
      }),
      dueFrom: day("2027-03-16"),
    };
    await store.add(filing);
    // Created at 04:59:59Z on the 16th, which is still the 15th in Bogota; the date is stored, never derived from the instant.
    await store.addOccurrence(
      pendingOccurrence(
        "occ-late" as OccurrenceId,
        filing,
        day("2027-03-15"),
        new Date("2027-03-16T04:59:59Z"),
      ),
    );
    const through = (iso: string) => list({ spaceId: "space-household", through: day(iso) });
    expect((await through("2027-03-15")).map((m) => [m.status, m.date])).toEqual([["PENDING", "2027-03-15"]]);
    expect((await through("2027-04-14")).map((m) => [m.status, m.date])).toEqual([["PENDING", "2027-03-15"]]);
    expect((await through("2027-04-15")).map((m) => [m.status, m.date])).toEqual([
      ["PENDING", "2027-03-15"],
      ["SCHEDULED", "2027-04-15"],
    ]);
  });
});
