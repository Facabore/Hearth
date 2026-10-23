/**
 * Ruling P221: the data the Plan routes are measured on. In the household `shared`, a six-plan chain from 2026-05 to
 * 2026-10 (each copied from the one before, May to September closed, October ACTIVE and the current period under the
 * e2e server's fixed clock), with expenses in every period, so the trends, the dashboards and the planner render what a
 * household sees, and a subcategory of Groceries so By group drills to its third level. In the personal space `personal`, an income and a bill that recur from 2026-11-01 on `bank`, so the
 * cash-flow calendar measures real rows (ruling P242).
 *
 * `api(method, path, body, ifMatch)` sends one request, with `If-Match: "<ifMatch>"` when given, and answers its JSON;
 * a non-2xx answer must throw. Answers `{ plan, line }`: the October plan's id and its Home line's id.
 */
export const seedPlanRoutes = async (api, { personal, shared, bank }) => {
  const cop = (pesos) => ({ amount: String(BigInt(pesos) * 100n), currency: "COP" });
  const keysOf = async (spaceId) => {
    const { items } = await api("GET", `/api/v1/spaces/${spaceId}/categories`);
    return Object.fromEntries(
      items.flatMap((g) => g.categories).flatMap((c) => (c.key ? [[c.key, c.id]] : [])),
    );
  };
  // Sign-up already opened a SAVINGS starter account (issue 169), whose name follows the locale; the Savings line uses it.
  const { items: personalAccounts } = await api("GET", `/api/v1/spaces/${personal}/accounts`);
  const savings = personalAccounts.find((account) => account.type === "SAVINGS");
  if (savings === undefined) throw new Error("The personal space has no SAVINGS starter account");
  const { items: members } = await api("GET", `/api/v1/spaces/${shared}/members`);
  const registered = members.filter((m) => m.kind === "USER");
  const keys = await keysOf(shared);
  const plans = `/api/v1/spaces/${shared}/plans`;
  const periods = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  let plan;
  for (const [index, period] of periods.entries()) {
    plan = await api("POST", plans, index === 0 ? { period } : { period, copyFrom: "previous" });
    const base = `${plans}/${plan.id}`;
    if (index === 0) {
      // HU-E6's reference plan: 4,000,000 COP of capacity (1,600,000 for the first member, the rest for the last).
      plan = await api(
        "PUT",
        `${base}/capacities`,
        {
          capacities: registered.map((m, i) => ({
            memberId: m.id,
            amount: cop(i === registered.length - 1 ? 4_000_000 - 1_600_000 * i : 1_600_000),
          })),
        },
        plan.version,
      );
      const lines = [
        ["Rent", 1_200_000, "SHARED_FUND", {}],
        ["Home", 1_470_000, "DIRECT", {}],
        ["Savings", 600_000, "SAVINGS", { savingsAccountIds: [savings.id] }],
        ["Free", 730_000, "DIRECT", {}],
      ];
      for (const [name, pesos, funding, extra] of lines)
        plan = await api(
          "POST",
          `${base}/lines`,
          { name, plannedAmount: cop(pesos), funding, rolloverMode: "RESET", ...extra },
          plan.version,
        );
      const lineIds = Object.fromEntries(plan.lines.map((l) => [l.name, l.id]));
      const mappings = [
        ["Rent", ["rent"]],
        ["Home", ["groceries", "utilities"]],
        ["Free", ["entertainment"]],
      ];
      for (const [line, categories] of mappings)
        plan = await api(
          "PUT",
          `${base}/lines/${lineIds[line]}/categories`,
          { categoryIds: categories.map((key) => keys[key]) },
          plan.version,
        );
    }
    plan = await api("POST", `${base}/activate`, {}, plan.version);
    // Ten expenses in October, three in each earlier period, paid from the recorder's own account.
    const count = period === "2026-10" ? 10 : 3;
    for (let i = 0; i < count; i += 1)
      await api("POST", `/api/v1/spaces/${shared}/expenses`, {
        description: `Household ${i}`,
        date: `${period}-${String(2 + i * 2).padStart(2, "0")}`,
        categoryId: keys[["groceries", "utilities", "entertainment"][i % 3]],
        amount: cop(40_000 + 10_000 * i + 5_000 * index),
        accountId: bank,
      });
    if (period !== "2026-10") plan = await api("POST", `${base}/close`, {}, plan.version);
  }
  // A named subcategory under Groceries, the largest row of October, so By group drills three levels (ruling P215).
  const subcategory = await api("POST", `/api/v1/spaces/${shared}/categories`, {
    parentCategoryId: keys.groceries,
    name: "Mercado del barrio",
  });
  await api("POST", `/api/v1/spaces/${shared}/expenses`, {
    description: "Mercado del barrio",
    date: "2026-10-24",
    categoryId: subcategory.id,
    amount: cop(300_000),
    accountId: bank,
  });
  const personalKeys = await keysOf(personal);
  const { items: personalMembers } = await api("GET", `/api/v1/spaces/${personal}/members`);
  const recurrence = (body) =>
    api("POST", `/api/v1/spaces/${personal}/recurrences`, { mode: "AUTO", startDate: "2026-11-01", ...body });
  await recurrence({
    description: "Salario",
    amount: cop(3_500_000),
    template: { type: "INCOME", categoryId: personalKeys.salary, accountId: bank },
    schedule: { kind: "MONTHLY", day: 30 },
  });
  await recurrence({
    description: "Internet",
    amount: cop(120_000),
    template: {
      type: "EXPENSE",
      categoryId: personalKeys.utilities,
      payer: { memberId: personalMembers[0].id, accountId: bank },
    },
    schedule: { kind: "MONTHLY", day: 5 },
  });
  return { plan: plan.id, line: plan.lines.find((l) => l.name === "Home").id };
};
