import { describe, expect, it } from "vitest";
import { budgetingWorld, HOUSEHOLD } from "../../../../tests/support/budgeting-world";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { createAddBudgetLine, type LineInput } from "./add-budget-line";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { createSetMemberCapacities } from "./set-member-capacities";
import { createUpdateBudgetLine, type LineChanges } from "./update-budget-line";

const cop = (pesos: number) => money(BigInt(pesos) * 100n);
const RENT: LineInput = { name: "Rent", plannedAmount: cop(1_200_000), funding: "SHARED_FUND" };

/**
 * D26 Background: a DRAFT plan for 2026-11 of Household (OWNER Ana, MEMBER Juan, VIEWER Sofi, guest Pedro) with
 * capacities Ana 1,600,000 COP and Juan 2,400,000 COP.
 */
const world = async () => {
  const w = budgetingWorld();
  const deps = { ...w.deps, capacities: w.plans, lines: w.plans };
  const plan = unwrap(
    await createCreateBudgetPlan(deps)({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" }),
  ).plan;
  unwrap(
    await createSetMemberCapacities(deps)({
      spaceId: HOUSEHOLD,
      userId: "u-ana",
      planId: plan.id,
      expectedVersion: null,
      capacities: [
        { memberId: "member-ana", amount: cop(1_600_000) },
        { memberId: "member-juan", amount: cop(2_400_000) },
      ],
    }),
  );
  const add = createAddBudgetLine(deps);
  const update = createUpdateBudgetLine(deps);
  const addLine = (line: LineInput, userId = "u-ana") =>
    add({ spaceId: HOUSEHOLD, userId, planId: plan.id, expectedVersion: null, line });
  const updateLine = (lineId: string, changes: LineChanges, userId = "u-ana") =>
    update({ spaceId: HOUSEHOLD, userId, planId: plan.id, lineId, expectedVersion: null, changes });
  const rentOf = (view: Awaited<ReturnType<typeof addLine>>) =>
    unwrap(view).figures.lines.find((l) => l.line.name === "Rent")!.line;
  return { ...w, plan, addLine, updateLine, rentOf };
};

describe("A plan line names who usually pays it (D26, #316)", () => {
  it("adds a line paid by Ana every period, and its allocation stays PROPORTIONAL", async () => {
    const { addLine, rentOf } = await world();
    const added = await addLine({ ...RENT, payerMemberIds: ["member-ana"] });
    const rent = rentOf(added);
    expect([rent.payerMemberIds, rent.payersScope, rent.allocationRule]).toEqual([
      ["member-ana"],
      "EVERY_PERIOD",
      "PROPORTIONAL",
    ]);
    const shares = unwrap(added).figures.lines[0]!.allocation.members.map((m) => [m.memberId, m.assigned]);
    expect(shares).toEqual([
      ["member-ana", 48_000_000n],
      ["member-juan", 72_000_000n],
      ["member-sofi", 0n],
      ["member-pedro", 0n],
    ]);
  });

  it("keeps a line without payers exactly as before: no payers and no scope", async () => {
    const { addLine, rentOf } = await world();
    const rent = rentOf(await addLine(RENT));
    expect([rent.payerMemberIds, rent.payersScope]).toEqual([[], null]);
  });

  it("names Ana and Juan for this period only", async () => {
    const { addLine, rentOf } = await world();
    const rent = rentOf(
      await addLine({ ...RENT, payerMemberIds: ["member-ana", "member-juan"], payersScope: "THIS_PERIOD" }),
    );
    expect([rent.payerMemberIds, rent.payersScope]).toEqual([["member-ana", "member-juan"], "THIS_PERIOD"]);
  });

  it("names only current members who are not VIEWERs, each once, and never on a SAVINGS line", async () => {
    const { addLine } = await world();
    const withPayers = (payerMemberIds: string[]) => addLine({ ...RENT, payerMemberIds });
    expect(codeOf(await withPayers(["member-ana", "member-ana"]))).toBe("InvalidLinePayers");
    expect(codeOf(await withPayers(["member-luis"]))).toBe("InvalidLinePayers");
    expect(codeOf(await withPayers(["member-sofi"]))).toBe("InvalidLinePayers");
    expect(
      codeOf(
        await addLine({
          name: "Savings",
          plannedAmount: cop(600_000),
          funding: "SAVINGS",
          savingsAccountIds: ["acc-savings"],
          payerMemberIds: ["member-ana"],
        }),
      ),
    ).toBe("InvalidLinePayers");
    // A guest of the space may pay a line: someone records it on their behalf (D15).
    expect(codeOf(await withPayers(["member-pedro"]))).toBe("ok");
  });

  it("refuses a scope without payers", async () => {
    const { addLine } = await world();
    expect(codeOf(await addLine({ ...RENT, payersScope: "THIS_PERIOD" }))).toBe("InvalidLinePayers");
  });

  it("lets the OWNER change the payers and scope; clearing the payers clears the scope", async () => {
    const { addLine, updateLine, rentOf } = await world();
    const id = rentOf(await addLine(RENT)).id;
    const named = rentOf(
      await updateLine(id, { payerMemberIds: ["member-juan"], payersScope: "THIS_PERIOD" }),
    );
    expect([named.payerMemberIds, named.payersScope]).toEqual([["member-juan"], "THIS_PERIOD"]);
    const renamed = rentOf(await updateLine(id, { plannedAmount: cop(1_100_000) }));
    expect([renamed.payerMemberIds, renamed.payersScope]).toEqual([["member-juan"], "THIS_PERIOD"]);
    const cleared = rentOf(await updateLine(id, { payerMemberIds: [] }));
    expect([cleared.payerMemberIds, cleared.payersScope]).toEqual([[], null]);
  });

  it("lets Juan, a payer of the line, change only its payers and scope", async () => {
    const { addLine, updateLine, rentOf } = await world();
    const id = rentOf(await addLine({ ...RENT, payerMemberIds: ["member-juan"] })).id;
    const changed = await updateLine(
      id,
      { payerMemberIds: ["member-juan", "member-ana"], payersScope: "THIS_PERIOD" },
      "u-juan",
    );
    expect([rentOf(changed).payerMemberIds, rentOf(changed).payersScope]).toEqual([
      ["member-juan", "member-ana"],
      "THIS_PERIOD",
    ]);
    expect(codeOf(await updateLine(id, { name: "Rent 2" }, "u-juan"))).toBe("InsufficientRole");
    expect(
      codeOf(await updateLine(id, { payerMemberIds: ["member-juan"], plannedAmount: cop(1) }, "u-juan")),
    ).toBe("InsufficientRole");
  });

  it("refuses Juan the payers of a line he does not pay, and Sofi as a VIEWER", async () => {
    const { addLine, updateLine, rentOf } = await world();
    const id = rentOf(await addLine({ ...RENT, payerMemberIds: ["member-ana"] })).id;
    expect(codeOf(await updateLine(id, { payerMemberIds: ["member-juan"] }, "u-juan"))).toBe(
      "InsufficientRole",
    );
    expect(codeOf(await updateLine(id, { payersScope: "THIS_PERIOD" }, "u-sofi"))).toBe("InsufficientRole");
  });

  it("still refuses a MEMBER every other edit as before", async () => {
    const { addLine, updateLine, rentOf } = await world();
    const id = rentOf(await addLine(RENT)).id;
    expect(codeOf(await updateLine(id, { name: "Home" }, "u-juan"))).toBe("InsufficientRole");
    expect(codeOf(await addLine({ ...RENT, name: "Gas" }, "u-juan"))).toBe("InsufficientRole");
  });

  it("drops the payers of a line that becomes SAVINGS", async () => {
    const { addLine, updateLine, rentOf, plans } = await world();
    const id = rentOf(await addLine({ ...RENT, payerMemberIds: ["member-ana"] })).id;
    unwrap(await updateLine(id, { funding: "SAVINGS", savingsAccountIds: ["acc-savings"] }));
    const saved = plans.lines.find((r) => r.line.id === id)!.line;
    expect([saved.funding, saved.payerMemberIds, saved.payersScope]).toEqual(["SAVINGS", [], null]);
  });

  it("keeps a payer who left on the line through other edits, and names no new former member", async () => {
    const { addLine, updateLine, rentOf, plans } = await world();
    const id = rentOf(await addLine({ ...RENT, payerMemberIds: ["member-ana"] })).id;
    plans.lines = plans.lines.map((r) =>
      r.line.id === id ? { ...r, line: { ...r.line, payerMemberIds: ["member-ana", "member-luis"] } } : r,
    );
    expect(codeOf(await updateLine(id, { name: "Arriendo" }))).toBe("ok");
    expect(codeOf(await updateLine(id, { payerMemberIds: ["member-luis", "member-ana"] }))).toBe("ok");
    expect(codeOf(await updateLine(id, { payerMemberIds: ["member-marta"] }))).toBe("InvalidLinePayers");
  });
});
