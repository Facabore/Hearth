import { expect, type Page } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures";
import { minor, shown } from "../support/money";
import type { World } from "../support/world";

const METHOD_KEYS: Record<string, string> = {
  BY_ALLOCATION: "ledger.split.methods.BY_ALLOCATION",
  EQUAL: "ledger.split.methods.EQUAL",
};
const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();
const cop = (pesos: string) => ({ amount: minor(pesos), currency: "COP" });
/** The page person's own row reads "<name> (tú)"; anyone else's their name. */
const labelOf = (world: World, name: string) =>
  name === world.user!.name ? world.t("members.you", { name }) : name;
const splitSheet = (page: Page, world: World) =>
  page.getByRole("dialog", { name: world.t("ledger.split.title") });

Given(
  "{string} is signed in and {string} has the members {string} and {string}",
  async ({ page, world }, name: string, space: string, _a: string, other: string) => {
    await world.signUp(name);
    await world.seedAccount("Bancolombia", { type: "BANK", openingBalance: cop("5,000,000") });
    const { id } = (await world.api.post("/api/v1/spaces", {
      kind: "SHARED",
      name: space,
      currency: "COP",
    })) as { id: string };
    world.spaces.set(space, id);
    const juan = await world.person(other);
    const { url } = (await world.api.post(`/api/v1/spaces/${id}/invitations`, {
      kind: "LINK",
      role: "MEMBER",
    })) as { url: string };
    await juan.api.post(`/api/v1/invitations/${new URL(url).pathname.split("/").at(-1)}/accept`, {});
    const { items } = (await world.api.get(`/api/v1/spaces/${id}/categories`)) as {
      items: { id: string; key: string | null }[];
    };
    const food = items.find((g) => g.key === "food")!;
    const groceries = (await world.api.post(`/api/v1/spaces/${id}/categories`, {
      groupId: food.id,
      name: "Groceries",
      icon: { kind: "SYMBOL", name: "cart" },
      color: "SAND",
    })) as { id: string };
    world.categories.set("Groceries", groceries.id);
    await page.clock.setFixedTime(new Date("2026-10-31T17:00:00Z"));
  },
);

const openForm = async (page: Page, world: World) => {
  await page.goto(`/spaces/${world.spaces.get("Household")}/new`);
  await expect(page.locator("[data-ready='true']")).toBeAttached();
};
const pick = async (page: Page, world: World, pesos: string, category: string) => {
  await page.getByLabel(world.t("ledger.form.amount")).fill(pesos.replaceAll(",", ""));
  await page.getByLabel(world.t("ledger.form.description")).fill(category);
  await page.getByRole("button", { name: new RegExp(world.t("ledger.form.category")) }).click();
  await page.getByRole("radio", { name: category }).click();
};
const shareOf = async (page: Page, world: World, name: string) =>
  norm(
    await splitSheet(page, world)
      .getByRole("listitem", { name: labelOf(world, name) })
      .textContent(),
  );

When(
  /^"([^"]+)" enters "([^"]+)" for ([\d,]+) COP paid from "([^"]+)" and selects "([^"]+)" and "([^"]+)" as participants$/,
  async (
    { page, world },
    _n: string,
    category: string,
    pesos: string,
    account: string,
    a: string,
    b: string,
  ) => {
    await openForm(page, world);
    await pick(page, world, pesos, category);
    // The payer row reads "Pagas tú desde <cuenta> (tu cuenta personal)": it is found by what comes before the account.
    const youPay = world.t("ledger.split.paidFromMine", { account: "@@" }).split("@@")[0]!.trim();
    await page.getByRole("button", { name: new RegExp(`^${youPay}`) }).click();
    const sheet = splitSheet(page, world);
    await sheet
      .getByRole("radiogroup", { name: world.t("ledger.split.from") })
      .getByRole("radio", { name: account })
      .click();
    await sheet.getByRole("radio", { name: world.t("ledger.split.methods.EQUAL") }).click();
    for (const name of [a, b])
      await expect(sheet.getByRole("checkbox", { name: labelOf(world, name) })).toBeChecked();
  },
);

Then(
  /^the preview shows ([\d,]+) COP for "([^"]+)" and ([\d,]+) COP for "([^"]+)"$/,
  async ({ page, world }, ana: string, a: string, juan: string, b: string) => {
    expect(await shareOf(page, world, a)).toContain(norm(shown(ana)));
    expect(await shareOf(page, world, b)).toContain(norm(shown(juan)));
  },
);

Then(
  /^after saving, the expense appears in the "([^"]+)" transaction list$/,
  async ({ page, world }, space: string) => {
    await splitSheet(page, world)
      .getByRole("button", { name: world.t("ledger.split.done") })
      .click();
    await page.getByRole("button", { name: world.t("ledger.form.save.EXPENSE") }).click();
    await expect(page).toHaveURL(`/spaces/${world.spaces.get(space)}/transactions`);
    const row = page.getByRole("listitem").filter({ hasText: "Groceries" });
    await expect(row).toContainText(world.t("ledger.paidBy", { name: world.user!.name }));
    expect(norm(await row.textContent())).toContain(norm(shown("300,000")));
  },
);

Given(
  /^the (\d{4}-\d{2}) plan of "([^"]+)" is "ACTIVE" and "([^"]+)" maps to "([^"]+)" allocated "([^"]+)" (\d+)% and "([^"]+)" (\d+)%$/,
  async (
    { world },
    period: string,
    space: string,
    category: string,
    line: string,
    a: string,
    aPct: string,
    b: string,
    bPct: string,
  ) => {
    const spaceId = world.spaces.get(space)!;
    const base = `/api/v1/spaces/${spaceId}/plans`;
    const plan = (await world.api.post(base, { period })) as { id: string };
    // PROPORTIONAL (a new line's rule, HU-E6-05) over capacities in the story's ratio gives exactly its percents.
    const [anaId, juanId] = [await world.memberId(space, a), await world.memberId(space, b)];
    await world.api.put(`${base}/${plan.id}/capacities`, {
      capacities: [
        { memberId: anaId, amount: cop(String(Number(aPct) * 40_000)) },
        { memberId: juanId, amount: cop(String(Number(bPct) * 40_000)) },
      ],
    });
    const withLine = (await world.api.post(`${base}/${plan.id}/lines`, {
      name: line,
      plannedAmount: cop("1,470,000"),
      funding: "DIRECT",
      rolloverMode: "RESET",
    })) as { lines: { id: string; name: string }[] };
    const lineId = withLine.lines.find((l) => l.name === line)!.id;
    await world.api.put(`${base}/${plan.id}/lines/${lineId}/categories`, {
      categoryIds: [world.categories.get(category)!],
    });
    await world.api.post(`${base}/${plan.id}/activate`, {});
  },
);

When(
  /^"([^"]+)" enters an expense of ([\d,]+) COP in "([^"]+)" dated (\d{4}-\d{2}-\d{2})$/,
  async ({ page, world }, _n: string, pesos: string, category: string, date: string) => {
    await page.clock.setFixedTime(new Date(`${date}T19:32:00Z`));
    await openForm(page, world);
    await pick(page, world, pesos, category);
  },
);

Then(
  /^the split "([^"]+)" is preselected with ([\d,]+) COP for "([^"]+)" and ([\d,]+) COP for "([^"]+)"$/,
  async ({ page, world }, method: string, ana: string, a: string, juan: string, b: string) => {
    const row = page.getByRole("button", { name: new RegExp(world.t("ledger.split.split")) });
    // The row reads "Con Ana y Juan · según el plan" (U2); the sheet's radio is named by the method itself.
    await expect(row).toContainText(world.t(`ledger.split.how.${method}`));
    await row.click();
    await expect(
      splitSheet(page, world).getByRole("radio", { name: world.t(METHOD_KEYS[method]!) }),
    ).toBeChecked();
    expect(await shareOf(page, world, a)).toContain(norm(shown(ana)));
    expect(await shareOf(page, world, b)).toContain(norm(shown(juan)));
  },
);

Then(
  /^switching to "([^"]+)" updates the preview to ([\d,]+) COP each$/,
  async ({ page, world }, method: string, each: string) => {
    await splitSheet(page, world)
      .getByRole("radio", { name: world.t(METHOD_KEYS[method]!) })
      .click();
    for (const name of ["Ana", "Juan"]) expect(await shareOf(page, world, name)).toContain(norm(shown(each)));
  },
);
