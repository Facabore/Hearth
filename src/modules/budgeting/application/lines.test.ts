import { describe, expect, it } from "vitest";
import { aLine } from "../../../../tests/support/budget-fixtures";
import { budgetingWorld, HOUSEHOLD, NOW, savingsAccounts } from "../../../../tests/support/budgeting-world";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { memberOf } from "../../../../tests/support/in-memory-spaces";
import { createAddBudgetLine, type LineInput } from "./add-budget-line";
import { createCreateBudgetPlan } from "./create-budget-plan";
import { lineOf, usableSavingsAccounts } from "./line-checks";
import { createRemoveBudgetLine } from "./remove-budget-line";
import { createSetMemberCapacities } from "./set-member-capacities";
import { createUpdateBudgetLine, type LineChanges } from "./update-budget-line";

const cop = (pesos: number) => money(BigInt(pesos) * 100n);
const RENT: LineInput = {
  name: "Rent",
  plannedAmount: cop(1_200_000),
  funding: "SHARED_FUND",
  rolloverMode: "RESET",
};
const HOME: LineInput = {
  name: "Home",
  plannedAmount: cop(1_470_000),
  funding: "DIRECT",
  rolloverMode: "RESET",
};
const SAVINGS: LineInput = {
  name: "Savings",
  plannedAmount: cop(600_000),
  funding: "SAVINGS",
  savingsAccountIds: ["acc-savings"],
};
const FREE: LineInput = { name: "Free", plannedAmount: cop(730_000) };

/** HU-E6-03 Background: a DRAFT plan for 2026-11 with capacities Ana 1,600,000 COP and Juan 2,400,000 COP. */
const world = async () => {
  const w = budgetingWorld();
  const deps = { ...w.deps, capacities: w.plans, lines: w.plans };
  const create = createCreateBudgetPlan(deps);
  const plan = unwrap(await create({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-11" })).plan;
  const capacities = [
    { memberId: "member-ana", amount: cop(1_600_000) },
    { memberId: "member-juan", amount: cop(2_400_000) },
  ];
  const set = createSetMemberCapacities(deps);
  unwrap(
    await set({ spaceId: HOUSEHOLD, userId: "u-ana", planId: plan.id, expectedVersion: null, capacities }),
  );
  const add = createAddBudgetLine(deps);
  const addLine = (line: LineInput, userId = "u-ana", expectedVersion: number | null = null) =>
    add({ spaceId: HOUSEHOLD, userId, planId: plan.id, expectedVersion, line });
  return { ...w, deps, plan, add, addLine };
};

describe("AddBudgetLine (HU-E6-03)", () => {
  it("reports 1,330,000 COP unallocated after Rent and Home, with Home at 36.75 % (golden)", async () => {
    const { addLine } = await world();
    unwrap(await addLine(RENT));
    const view = unwrap(await addLine(HOME));
    expect(view.figures.unallocated).toBe(133_000_000n);
    const home = view.figures.lines.find((l) => l.line.name === "Home")!;
    expect([
      home.capacityShareBasisPoints,
      home.line.funding,
      home.line.rolloverMode,
      home.allocation.rule,
    ]).toEqual([3675, "DIRECT", "RESET", "PROPORTIONAL"]);
    expect(view.plan.version).toBe(4);
  });

  it("leaves nothing unallocated with the full reference plan, and refuses Travel past it (golden)", async () => {
    const { addLine } = await world();
    for (const line of [RENT, HOME, SAVINGS]) unwrap(await addLine(line));
    expect(unwrap(await addLine(FREE)).figures.unallocated).toBe(0n);
    expect(codeOf(await addLine({ name: "Travel", plannedAmount: cop(100_000) }))).toBe(
      "PlanExceedsCapacity",
    );
  });

  it("funds a line DIRECT and resets its rollover when it names neither (assumption 5)", async () => {
    const { addLine } = await world();
    const view = unwrap(await addLine(FREE));
    const [free] = view.figures.lines;
    expect([
      free!.line.funding,
      free!.line.rolloverMode,
      free!.line.isCatchAll,
      free!.line.savingsAccountIds,
    ]).toEqual(["DIRECT", "RESET", false, []]);
  });

  it("keeps names unique within the plan ignoring case, and planned amounts positive in the space currency", async () => {
    const { addLine } = await world();
    unwrap(await addLine(HOME));
    expect(codeOf(await addLine({ ...HOME, name: "home" }))).toBe("BudgetLineNameTaken");
    expect(codeOf(await addLine({ name: "Gifts", plannedAmount: cop(0) }))).toBe("InvalidPlannedAmount");
    expect(codeOf(await addLine({ name: "Gifts", plannedAmount: money(100n, "USD") }))).toBe(
      "CurrencyMismatch",
    );
  });

  it("counts only the capacity of the current members (P7)", async () => {
    const { addLine, plans, plan } = await world();
    // Luis left the space but his row stays (D8): his 1,000,000 COP must not make room for the line.
    plans.seed(plan.id, { capacities: [{ memberId: "member-luis", amount: cop(1_000_000).minor }] });
    expect(codeOf(await addLine({ name: "Big", plannedAmount: cop(4_000_001) }))).toBe("PlanExceedsCapacity");
    expect(codeOf(await addLine({ name: "Big", plannedAmount: cop(4_000_000) }))).toBe("ok");
  });

  it("requires the caller's own SAVINGS accounts, not archived and in the plan currency, on a SAVINGS line (Review Focus 5, P8, I1)", async () => {
    const { addLine } = await world();
    const savingsWith = (savingsAccountIds: string[]) => addLine({ ...SAVINGS, savingsAccountIds });
    expect(codeOf(await savingsWith([]))).toBe("SavingsAccountRequired");
    expect(codeOf(await savingsWith(["acc-bank"]))).toBe("InvalidSavingsAccount");
    expect(codeOf(await savingsWith(["acc-old-savings"]))).toBe("AccountArchived");
    expect(codeOf(await savingsWith(["acc-usd-savings"]))).toBe("CurrencyMismatch");
    const view = unwrap(await savingsWith(["acc-savings", "acc-reserve"]));
    expect(view.figures.lines[0]!.line.savingsAccountIds).toEqual(["acc-savings", "acc-reserve"]);
  });

  it("answers the identical AccountNotFound for every account the caller cannot attach, so none is revealed (P8)", async () => {
    const { addLine, plans } = await world();
    const attach = (id: string) => addLine({ ...SAVINGS, savingsAccountIds: [id] });
    const unknown = await attach("acc-unknown");
    expect(codeOf(unknown)).toBe("AccountNotFound");
    // A member's savings, bank and archived accounts, a non-member's, a malformed id: all answer as unknown does.
    for (const id of [
      "acc-juan-savings",
      "acc-juan-bank",
      "acc-juan-old-savings",
      "acc-marta-savings",
      "acc-luis-savings",
      "not-a-uuid",
      "",
    ]) {
      expect(await attach(id)).toEqual(unknown);
    }
    expect(plans.lines).toEqual([]);
  });

  it("lets one savings account back one SAVINGS line of the plan", async () => {
    const { addLine } = await world();
    unwrap(await addLine(SAVINGS));
    expect(codeOf(await addLine({ ...SAVINGS, name: "More savings" }))).toBe("SavingsAccountAlreadyUsed");
    expect(codeOf(await addLine({ ...SAVINGS, name: "Reserve", savingsAccountIds: ["acc-reserve"] }))).toBe(
      "ok",
    );
  });

  it("adds the catch-all line once (HU-E6-04)", async () => {
    const { addLine } = await world();
    unwrap(await addLine({ ...FREE, isCatchAll: true }));
    expect(codeOf(await addLine({ ...HOME, isCatchAll: true }))).toBe("CatchAllLineAlreadySet");
    expect(codeOf(await addLine({ ...SAVINGS, isCatchAll: true }))).toBe("SavingsLineNotMappable");
  });

  it("lets only owners and admins add lines, and refuses a stale If-Match", async () => {
    const { addLine } = await world();
    expect(codeOf(await addLine(HOME, "u-juan"))).toBe("InsufficientRole");
    expect(codeOf(await addLine(HOME, "u-ana", 1))).toBe("PreconditionFailed");
    expect(codeOf(await addLine(HOME, "u-ana", 2))).toBe("ok");
  });

  it("answers SpaceNotFound to a stranger, SpaceArchived in an archived space and BudgetPlanNotFound for any other plan", async () => {
    const { add, addLine, spaces, plan } = await world();
    const asMarta = await add({
      spaceId: HOUSEHOLD,
      userId: "u-marta",
      planId: plan.id,
      expectedVersion: null,
      line: HOME,
    });
    expect(codeOf(asMarta)).toBe("SpaceNotFound");
    for (const planId of ["budget-404", "not-a-uuid", ""]) {
      const unknown = await add({
        spaceId: HOUSEHOLD,
        userId: "u-ana",
        planId,
        expectedVersion: null,
        line: HOME,
      });
      expect(codeOf(unknown)).toBe("BudgetPlanNotFound");
    }
    spaces.archived.add(HOUSEHOLD);
    expect(codeOf(await addLine(HOME))).toBe("SpaceArchived");
  });
});

describe("line checks (HU-E6-03)", () => {
  const parts = {
    capacities: [],
    mappings: [],
    allocations: [],
    lines: [aLine("Home", 100n), aLine("Rent", 200n)],
  };

  it("finds only the current lines of the plan, whatever the id looks like", () => {
    expect(unwrap(lineOf(parts, "line-home")).name).toBe("Home");
    for (const id of ["line-gone", "", "not-a-uuid", "' OR 1=1 --"]) {
      expect(codeOf(lineOf(parts, id))).toBe("BudgetLineNotFound");
    }
  });

  const ana = { userId: "u-ana", currency: "COP" };

  it("checks the accounts a line newly names, and skips those it already named (Task 12b)", async () => {
    const check = (ids: string[], already: string[] = []) =>
      usableSavingsAccounts(savingsAccounts, ana, ids, already);
    expect(codeOf(await check(["acc-old-savings"]))).toBe("AccountArchived");
    expect(codeOf(await check(["acc-old-savings"], ["acc-old-savings"]))).toBe("ok");
    expect(codeOf(await check(["acc-savings", "acc-old-savings"], ["acc-old-savings"]))).toBe("ok");
    expect(codeOf(await check(["acc-marta-savings"], ["acc-savings"]))).toBe("AccountNotFound");
    // What the line named before stays, whoever owns it and whatever currency it keeps (P8, I1).
    const kept = ["acc-juan-savings", "acc-usd-savings"];
    expect(codeOf(await check(kept, kept))).toBe("ok");
  });

  it("lets the caller attach only an account they own: another owner's is AccountNotFound (P8)", async () => {
    const as = (userId: string, ids: string[]) =>
      usableSavingsAccounts(savingsAccounts, { userId, currency: "COP" }, ids);
    expect(codeOf(await as("u-ana", ["acc-savings"]))).toBe("ok");
    expect(codeOf(await as("u-ana", ["acc-juan-savings"]))).toBe("AccountNotFound");
    expect(codeOf(await as("u-juan", ["acc-juan-savings"]))).toBe("ok");
    expect(codeOf(await as("u-juan", ["acc-savings"]))).toBe("AccountNotFound");
    expect(codeOf(await as("u-ana", ["acc-nothing"]))).toBe("AccountNotFound");
  });

  it("refuses an own account in another currency than the space's with CurrencyMismatch, naming both (D6, I1)", async () => {
    const check = (currency: string, ids: string[]) =>
      usableSavingsAccounts(savingsAccounts, { userId: "u-ana", currency }, ids);
    expect(codeOf(await check("COP", ["acc-usd-savings"]))).toBe("CurrencyMismatch");
    expect(await check("COP", ["acc-usd-savings"])).toMatchObject({
      error: { details: { expected: "COP", actual: "USD" } },
    });
    expect(codeOf(await check("USD", ["acc-usd-savings"]))).toBe("ok");
    expect(codeOf(await check("USD", ["acc-savings"]))).toBe("CurrencyMismatch");
  });
});

describe("UpdateBudgetLine and RemoveBudgetLine (HU-E6-03, HU-E6-04)", () => {
  /** The reference plan's four lines, all DIRECT or as spec section 4 funds them. */
  const reference = async () => {
    const w = await world();
    let view = unwrap(await w.addLine(RENT));
    for (const line of [HOME, SAVINGS, FREE]) view = unwrap(await w.addLine(line));
    const lines = view.figures.lines;
    const id = (name: string) => lines.find((l) => l.line.name === name)!.line.id;
    const input = (lineId: string, expectedVersion: number | null = null) => ({
      spaceId: HOUSEHOLD,
      userId: "u-ana",
      planId: w.plan.id,
      lineId,
      expectedVersion,
    });
    return {
      ...w,
      id,
      input,
      update: createUpdateBudgetLine(w.deps),
      remove: createRemoveBudgetLine(w.deps),
    };
  };

  it("refuses an increase past the capacity, and lets a plan over its capacity lower a line", async () => {
    const { id, input, update, deps, plan } = await reference();
    const raise = await update({ ...input(id("Home")), changes: { plannedAmount: cop(1_500_000) } });
    expect(codeOf(raise)).toBe("PlanExceedsCapacity");
    const juan = [{ memberId: "member-juan", amount: cop(2_000_000) }];
    const set = createSetMemberCapacities(deps);
    unwrap(
      await set({
        spaceId: HOUSEHOLD,
        userId: "u-ana",
        planId: plan.id,
        expectedVersion: null,
        capacities: juan,
      }),
    );
    const lowered = unwrap(
      await update({ ...input(id("Home")), changes: { plannedAmount: cop(1_400_000) } }),
    );
    expect(lowered.figures.unallocated).toBe(-33_000_000n);
  });

  it("renames a line and changes its funding and rollover mode, keeping its allocation rule", async () => {
    const { id, input, update } = await reference();
    const changes = { name: "House", funding: "SHARED_FUND" as const, rolloverMode: "ROLLOVER" as const };
    const view = unwrap(await update({ ...input(id("Home")), changes }));
    const house = view.figures.lines.find((l) => l.line.name === "House")!.line;
    expect([house.funding, house.rolloverMode, house.allocationRule]).toEqual([
      "SHARED_FUND",
      "ROLLOVER",
      "PROPORTIONAL",
    ]);
  });

  it("marks Free as the catch-all line, and refuses a second one (HU-E6-04)", async () => {
    const { id, input, update } = await reference();
    expect(
      unwrap(await update({ ...input(id("Free")), changes: { isCatchAll: true } })).figures.unbudgeted,
    ).toBeNull();
    const second = await update({ ...input(id("Home")), changes: { isCatchAll: true } });
    expect(codeOf(second)).toBe("CatchAllLineAlreadySet");
  });

  it("checks only the savings accounts a line newly names, so an account archived since stays", async () => {
    const { id, input, deps } = await reference();
    const archivedSince = createUpdateBudgetLine({
      ...deps,
      savingsAccounts: {
        find: async (accountId) => {
          const account = await savingsAccounts.find(accountId);
          return account && { ...account, archived: true };
        },
      },
    });
    expect(codeOf(await archivedSince({ ...input(id("Savings")), changes: { name: "Ahorro" } }))).toBe("ok");
    const more = { savingsAccountIds: ["acc-savings", "acc-reserve"] };
    expect(codeOf(await archivedSince({ ...input(id("Savings")), changes: more }))).toBe("AccountArchived");
    const onHome = await archivedSince({
      ...input(id("Home")),
      changes: { savingsAccountIds: ["acc-savings"] },
    });
    expect(codeOf(onHome)).toBe("InvalidSavingsAccount");
  });

  it("removes a line logically: it leaves the figures, frees its name and keeps its row (D8, Review Focus 6)", async () => {
    const { id, input, remove, plans, addLine } = await reference();
    const homeId = id("Home");
    const view = unwrap(await remove(input(homeId)));
    expect(view.figures.lines.map((l) => l.line.name)).toEqual(["Rent", "Savings", "Free"]);
    expect(view.figures.unallocated).toBe(147_000_000n);
    expect(plans.lines.find((r) => r.line.id === homeId)!.deletedAt).toEqual(NOW);
    expect(codeOf(await addLine(HOME))).toBe("ok");
    expect(codeOf(await remove(input(homeId)))).toBe("BudgetLineNotFound");
  });

  it("answers BudgetLineNotFound for unknown lines, and refuses Juan and a stale If-Match", async () => {
    const { id, input, update, remove } = await reference();
    expect(codeOf(await update({ ...input("line-404"), changes: { name: "X" } }))).toBe("BudgetLineNotFound");
    expect(codeOf(await remove({ ...input(id("Home")), userId: "u-juan" }))).toBe("InsufficientRole");
    expect(codeOf(await remove(input(id("Home"), 1)))).toBe("PreconditionFailed");
  });

  it("keeps names 1 to 60 characters and unique ignoring case, amounts positive and in the space currency", async () => {
    const { id, input, update } = await reference();
    const home = (changes: LineChanges) => update({ ...input(id("Home")), changes });
    expect(codeOf(await home({ name: "rent" }))).toBe("BudgetLineNameTaken");
    for (const name of ["", "   ", "x".repeat(61)]) {
      expect(codeOf(await home({ name }))).toBe("InvalidBudgetLineName");
    }
    for (const plannedAmount of [cop(0), cop(-1)]) {
      expect(codeOf(await home({ plannedAmount }))).toBe("InvalidPlannedAmount");
    }
    expect(codeOf(await home({ plannedAmount: money(100n, "USD") }))).toBe("CurrencyMismatch");
    // A line keeps its own name in any case; names are trimmed and 60 characters fit.
    expect(codeOf(await home({ name: "HOME" }))).toBe("ok");
    expect(unwrap(await home({ name: "  Casa  " })).figures.lines.map((l) => l.line.name)).toContain("Casa");
    expect(codeOf(await home({ name: "x".repeat(60) }))).toBe("ok");
  });

  it("lets a plan over its capacity rename and re-save a line, but not raise one by a single minor unit", async () => {
    const { id, input, update, deps, plan } = await reference();
    const juan = [{ memberId: "member-juan", amount: cop(2_000_000) }];
    const set = createSetMemberCapacities(deps);
    unwrap(
      await set({
        spaceId: HOUSEHOLD,
        userId: "u-ana",
        planId: plan.id,
        expectedVersion: null,
        capacities: juan,
      }),
    );
    const home = (changes: LineChanges) => update({ ...input(id("Home")), changes });
    expect(codeOf(await home({ name: "House" }))).toBe("ok");
    expect(codeOf(await home({ plannedAmount: cop(1_470_000) }))).toBe("ok");
    expect(codeOf(await home({ plannedAmount: money(147_000_001n) }))).toBe("PlanExceedsCapacity");
    expect(codeOf(await home({ funding: "SHARED_FUND", rolloverMode: "ADJUSTED" }))).toBe("ok");
  });

  it("moves the catch-all line, and never makes a SAVINGS line one (HU-E6-04)", async () => {
    const { id, input, update } = await reference();
    const as = (name: string, changes: LineChanges) => update({ ...input(id(name)), changes });
    expect(codeOf(await as("Free", { isCatchAll: true }))).toBe("ok");
    expect(codeOf(await as("Free", { isCatchAll: true }))).toBe("ok");
    expect(codeOf(await as("Savings", { isCatchAll: true }))).toBe("SavingsLineNotMappable");
    const toSavings = { funding: "SAVINGS" as const, savingsAccountIds: ["acc-reserve"] };
    expect(codeOf(await as("Free", toSavings))).toBe("SavingsLineNotMappable");
    expect(unwrap(await as("Free", { isCatchAll: false })).figures.unbudgeted).not.toBeNull();
    expect(unwrap(await as("Home", { isCatchAll: true })).figures.unbudgeted).toBeNull();
  });

  it("refuses to turn a line with mapped categories into a SAVINGS line, and unmaps nothing", async () => {
    const { id, input, update, plans, plan } = await reference();
    plans.seed(plan.id, { mappings: [{ lineId: id("Home"), categoryId: "cat-groceries" }] });
    const toSavings = { funding: "SAVINGS" as const, savingsAccountIds: ["acc-reserve"] };
    expect(codeOf(await update({ ...input(id("Home")), changes: toSavings }))).toBe("SavingsLineNotMappable");
    expect(plans.mappings.map((m) => m.unmappedAt)).toEqual([null]);
    expect(codeOf(await update({ ...input(id("Free")), changes: toSavings }))).toBe("ok");
  });

  it("keeps the accounts of a SAVINGS line when it is edited, and drops them when it stops being one", async () => {
    const { id, input, update } = await reference();
    const changes = { name: "Ahorro", plannedAmount: cop(500_000), rolloverMode: "ROLLOVER" as const };
    const edited = unwrap(await update({ ...input(id("Savings")), changes }));
    const ahorro = edited.figures.lines.find((l) => l.line.name === "Ahorro")!.line;
    expect([ahorro.funding, ahorro.savingsAccountIds]).toEqual(["SAVINGS", ["acc-savings"]]);
    const direct = unwrap(await update({ ...input(id("Savings")), changes: { funding: "DIRECT" } }));
    expect(direct.figures.lines.find((l) => l.line.name === "Ahorro")!.line.savingsAccountIds).toEqual([]);
  });

  it("applies the savings rules of a new line to an edited one (Review Focus 5)", async () => {
    const { id, input, update } = await reference();
    const as = (name: string, changes: LineChanges) => update({ ...input(id(name)), changes });
    const onSavings = (savingsAccountIds: string[]) => as("Savings", { savingsAccountIds });
    expect(codeOf(await as("Home", { funding: "SAVINGS" }))).toBe("SavingsAccountRequired");
    expect(codeOf(await onSavings([]))).toBe("SavingsAccountRequired");
    expect(codeOf(await onSavings(["acc-savings", "acc-savings"]))).toBe("InvalidSavingsAccount");
    expect(codeOf(await onSavings(["acc-bank"]))).toBe("InvalidSavingsAccount");
    expect(codeOf(await onSavings(["acc-old-savings"]))).toBe("AccountArchived");
    expect(codeOf(await onSavings(["acc-usd-savings"]))).toBe("CurrencyMismatch");
    expect(codeOf(await onSavings(["acc-marta-savings"]))).toBe("AccountNotFound");
    expect(codeOf(await onSavings(["acc-juan-savings"]))).toBe("AccountNotFound");
    expect(codeOf(await onSavings(["acc-unknown"]))).toBe("AccountNotFound");
    const replaced = unwrap(await onSavings(["acc-reserve"]));
    const savings = replaced.figures.lines.find((l) => l.line.name === "Savings")!.line;
    expect(savings.savingsAccountIds).toEqual(["acc-reserve"]);
  });

  it("lets one savings account back one SAVINGS line of the plan, on edits too", async () => {
    const { id, input, update } = await reference();
    const as = (name: string, changes: LineChanges) => update({ ...input(id(name)), changes });
    expect(codeOf(await as("Home", { funding: "SAVINGS", savingsAccountIds: ["acc-reserve"] }))).toBe("ok");
    expect(codeOf(await as("Home", { savingsAccountIds: ["acc-savings"] }))).toBe(
      "SavingsAccountAlreadyUsed",
    );
    const both = { savingsAccountIds: ["acc-savings", "acc-reserve"] };
    expect(codeOf(await as("Savings", both))).toBe("SavingsAccountAlreadyUsed");
    const free = { funding: "SAVINGS" as const, savingsAccountIds: ["acc-savings"] };
    expect(codeOf(await as("Free", free))).toBe("SavingsAccountAlreadyUsed");
    // The line's own accounts are not taken by another line.
    expect(codeOf(await as("Home", { name: "Reserve", savingsAccountIds: ["acc-reserve"] }))).toBe("ok");
  });

  it("lets an ADMIN attach only their own account, and keeps it on the line after they left, without its transfers (P8)", async () => {
    const { id, input, update, spaces, spending } = await reference();
    await spaces.addMember(HOUSEHOLD, memberOf("Luis", "ADMIN", 4));
    spending.byAccount = [
      { accountId: "acc-savings", amount: 10_000_000n },
      { accountId: "acc-luis-savings", amount: 5_000_000n },
    ];
    const as = (userId: string, name: string, changes: LineChanges) =>
      update({ ...input(id(name)), userId, changes });
    const both = { savingsAccountIds: ["acc-savings", "acc-luis-savings"] };
    // Ana cannot attach Luis's account; Luis attaches it, and the account Ana's line already names stays unchecked.
    expect(codeOf(await as("u-ana", "Savings", both))).toBe("AccountNotFound");
    const attached = unwrap(await as("u-luis", "Savings", both));
    expect(attached.figures.lines.find((l) => l.line.name === "Savings")!.spent).toBe(15_000_000n);

    expect(await spaces.markLeft(HOUSEHOLD, "member-luis", "USER", NOW)).toBe(true);
    const renamed = unwrap(await as("u-ana", "Savings", { name: "Ahorro" }));
    const ahorro = renamed.figures.lines.find((l) => l.line.name === "Ahorro")!;
    expect([ahorro.line.savingsAccountIds, ahorro.spent]).toEqual([both.savingsAccountIds, 10_000_000n]);
    // Luis's other accounts remain his: nobody attaches them for him.
    const toLuis = { funding: "SAVINGS" as const, savingsAccountIds: ["acc-luis-other"] };
    expect(codeOf(await as("u-ana", "Home", toLuis))).toBe("AccountNotFound");
  });

  it("ends the mappings of a removed line and leaves its allocations unsuperseded but out of every read (D8)", async () => {
    const { id, input, remove, plans, plan } = await reference();
    const homeId = id("Home");
    plans.seed(plan.id, {
      mappings: [{ lineId: homeId, categoryId: "cat-groceries" }],
      allocations: [{ lineId: homeId, memberId: "member-ana", value: 5n }],
    });
    const view = unwrap(await remove(input(homeId)));
    expect(view.figures.lines.map((l) => l.line.name)).not.toContain("Home");
    expect(plans.mappings.map((m) => m.unmappedAt)).toEqual([NOW]);
    expect(plans.allocations.map((a) => a.supersededAt)).toEqual([null]);
    expect((await plans.contents(plan.id)).allocations).toEqual([]);
  });

  it("frees the catch-all flag and the savings account of a removed line", async () => {
    const { id, input, update, remove, addLine } = await reference();
    unwrap(await update({ ...input(id("Free")), changes: { isCatchAll: true } }));
    unwrap(await remove(input(id("Free"))));
    expect(codeOf(await update({ ...input(id("Home")), changes: { isCatchAll: true } }))).toBe("ok");
    unwrap(await remove(input(id("Savings"))));
    expect(codeOf(await addLine({ ...SAVINGS, name: "Ahorro" }))).toBe("ok");
  });

  it("lets a plan over its capacity remove a line: removing never needs a capacity check", async () => {
    const { id, input, remove, deps, plan } = await reference();
    const juan = [{ memberId: "member-juan", amount: cop(0) }];
    const set = createSetMemberCapacities(deps);
    unwrap(
      await set({
        spaceId: HOUSEHOLD,
        userId: "u-ana",
        planId: plan.id,
        expectedVersion: null,
        capacities: juan,
      }),
    );
    expect(unwrap(await remove(input(id("Rent")))).figures.unallocated).toBe(-120_000_000n);
  });

  it("never touches a line of another plan", async () => {
    const { input, update, remove, plans, deps } = await reference();
    const december = unwrap(
      await createCreateBudgetPlan(deps)({ spaceId: HOUSEHOLD, userId: "u-ana", period: "2026-12" }),
    ).plan;
    plans.seed(december.id, { lines: [aLine("Dec", 100n)] });
    expect(codeOf(await update({ ...input("line-dec"), changes: { name: "X" } }))).toBe("BudgetLineNotFound");
    expect(codeOf(await remove(input("line-dec")))).toBe("BudgetLineNotFound");
    const kept = plans.lines.find((r) => r.line.id === "line-dec")!;
    expect([kept.line.name, kept.line.planId, kept.deletedAt]).toEqual(["Dec", december.id, null]);
  });

  it("answers SpaceNotFound to a stranger, SpaceArchived in an archived space and BudgetPlanNotFound for any other plan", async () => {
    const { id, input, update, remove, spaces } = await reference();
    type Patch = { userId?: string; planId?: string };
    const writes = [
      (patch: Patch) => update({ ...input(id("Home")), changes: { name: "House" }, ...patch }),
      (patch: Patch) => remove({ ...input(id("Home")), ...patch }),
    ];
    for (const write of writes) {
      expect(codeOf(await write({ userId: "u-marta" }))).toBe("SpaceNotFound");
      expect(codeOf(await write({ userId: "u-sofi" }))).toBe("InsufficientRole");
      for (const planId of ["budget-404", "not-a-uuid", ""]) {
        expect(codeOf(await write({ planId }))).toBe("BudgetPlanNotFound");
      }
    }
    spaces.archived.add(HOUSEHOLD);
    for (const write of writes) expect(codeOf(await write({}))).toBe("SpaceArchived");
  });

  it("refuses a stale If-Match on an edit and answers the plan at its new version for the current one", async () => {
    const { id, input, update } = await reference();
    const changes = { name: "House" };
    expect(codeOf(await update({ ...input(id("Home"), 1), changes }))).toBe("PreconditionFailed");
    const view = unwrap(await update({ ...input(id("Home"), 6), changes }));
    expect(view.plan.version).toBe(7);
  });
});
