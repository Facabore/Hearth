import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures";
import type { World } from "../support/world";

const escaped = (path: string) => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const homePath = (world: World) => `/spaces/${world.user!.spaceId}`;
const spaceId = (world: World, space: string) => {
  const id = world.spaces.get(space);
  if (!id) throw new Error(`No space ${space} in this scenario`);
  return id;
};

When("{string} opens the address {string}", async ({ page, world }, name: string, address: string) => {
  expect(name).toBe(world.user!.name);
  await page.goto(address);
});

Then("the not-found page is shown", async ({ page, world }) => {
  await expect(page.getByRole("heading", { level: 1, name: world.t("notFound.title") })).toBeVisible();
  await expect(page.getByText(world.t("notFound.body"))).toBeVisible();
  await expect(page.getByRole("link", { name: world.t("common.toStart") })).toHaveAttribute("href", "/");
});

When("{string} chooses the way out of the not-found page", async ({ page, world }, name: string) => {
  expect(name).toBe(world.user!.name);
  await page.getByRole("link", { name: world.t("common.toStart") }).click();
});

Given("the browser prefers the dark color scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
});

Then("the page background is the dark one", async ({ page }) => {
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // --bg of the dark palette (globals.css).
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(18, 22, 20)");
});

When("{string} opens Ajustes from the user menu", async ({ page, world }, name: string) => {
  await page.getByRole("button", { name: world.t("shell.profile.open", { name }) }).click();
  await page.getByRole("link", { name: new RegExp(world.t("shell.profile.settings")) }).click();
  await expect(page).toHaveURL(/\/settings\?from=/);
});

When(
  "{string} opens the create-space link of the space switcher of {string}",
  async ({ page, world }, name: string, space: string) => {
    expect(name).toBe(world.user!.name);
    await page.getByRole("button", { name: world.t("shell.space.current", { name: space }) }).click();
    await page.getByRole("link", { name: world.t("shell.space.create") }).click();
    await expect(page).toHaveURL(/\/spaces\/new\?/);
  },
);

/** The header's space switcher and the navigation's links name the space the shell belongs to. */
Then("the shell of the screen is the one of {string}", async ({ page, world }, space: string) => {
  await expect(
    page.getByRole("button", { name: world.t("shell.space.current", { name: space }) }),
  ).toBeVisible();
  const id = space === "Personal" ? world.user!.spaceId : spaceId(world, space);
  const nav = page.getByRole("navigation", { name: world.t("shell.nav.main") });
  await expect(nav.getByRole("link", { name: world.t("shell.nav.home"), exact: true })).toHaveAttribute(
    "href",
    `/spaces/${id}`,
  );
  await expect(nav.getByRole("link", { name: world.t("shell.nav.record") })).toHaveAttribute(
    "href",
    `/spaces/${id}/new`,
  );
});

When("{string} taps Inicio in the navigation", async ({ page, world }, name: string) => {
  expect(name).toBe(world.user!.name);
  await page
    .getByRole("navigation", { name: world.t("shell.nav.main") })
    .getByRole("link", { name: world.t("shell.nav.home"), exact: true })
    .click();
});

When(
  "{string} follows the sign-in link that leads to the members screen of {string}",
  async ({ page, world }, name: string, space: string) => {
    expect(name).toBe(world.user!.name);
    const next = encodeURIComponent(`/spaces/${spaceId(world, space)}/members`);
    await page.goto(`/sign-in?next=${next}`);
  },
);

When("{string} opens the account picker of the form", async ({ page, world }, name: string) => {
  expect(name).toBe(world.user!.name);
  await page.getByRole("button", { name: new RegExp(world.t("ledger.form.account")) }).click();
});

Then("the picker explains that there are no accounts", async ({ page, world }) => {
  await expect(
    page
      .getByRole("dialog", { name: world.t("ledger.form.account") })
      .getByText(world.t("accounts.picker.empty")),
  ).toBeVisible();
});

When("{string} chooses {string} in the picker", async ({ page, world }, name: string, action: string) => {
  expect(name).toBe(world.user!.name);
  expect(action).toBe(world.t("accounts.new"));
  await page
    .getByRole("dialog", { name: world.t("ledger.form.account") })
    .getByRole("link", { name: action })
    .click();
  await expect(page).toHaveURL(new RegExp(`${escaped(homePath(world))}/accounts/new\\?returnTo=`));
});

When(
  "{string} saves the new CASH account {string}",
  async ({ page, world }, name: string, account: string) => {
    expect(name).toBe(world.user!.name);
    await page.getByRole("radio", { name: world.t("accounts.type.CASH") }).click();
    await page.getByLabel(world.t("accounts.field.name")).fill(account);
    await page.getByLabel(world.t("accounts.field.opening")).fill("0");
    await page.getByRole("button", { name: world.t("accounts.create") }).click();
  },
);

Then("the new expense form is shown with the account {string}", async ({ page, world }, account: string) => {
  await expect(page).toHaveURL(new RegExp(`${escaped(homePath(world))}/new$`));
  await expect(page.locator("[data-ready='true']")).toBeAttached();
  await expect(
    page.getByRole("button", { name: new RegExp(`${world.t("ledger.form.account")}\\s*${account}`) }),
  ).toBeVisible();
});

Given(
  "{string} has the category {string} in her personal space",
  async ({ world }, name: string, category: string) => {
    expect(name).toBe(world.user!.name);
    await world.seedCategory(category);
  },
);

When(
  "{string} filters Movimientos by the category {string}",
  async ({ page, world }, name: string, category: string) => {
    expect(name).toBe(world.user!.name);
    await page.getByRole("button", { name: world.t("ledger.list.filterCategory") }).click();
    await page
      .getByRole("dialog", { name: world.t("ledger.list.filterTitle") })
      .getByRole("radio", { name: category })
      .click();
  },
);

Then("Movimientos shows the filter {string}", async ({ page, world }, category: string) => {
  await expect(page).toHaveURL(/\/transactions\?category=/);
  await expect(
    page.getByRole("button", { name: world.t("ledger.list.removeFilter", { name: category }) }),
  ).toBeVisible();
});

When(
  "{string} opens the settle-up link of {string}",
  async ({ page, world }, name: string, space: string) => {
    expect(name).toBe(world.user!.name);
    const id = spaceId(world, space);
    const { items } = (await world.api.get(`/api/v1/spaces/${id}/members`)) as {
      items: { id: string; userId: string | null }[];
    };
    const mine = items.find((member) => member.userId !== null)!;
    await page.goto(`/spaces/${id}/balances?settle=${mine.id}`);
  },
);

Then("the settle-up sheet is open", async ({ page, world }) => {
  await expect(page.getByRole("dialog", { name: world.t("balances.settle.title") })).toBeVisible();
});

When("{string} closes the settle-up sheet", async ({ page, world }, name: string) => {
  expect(name).toBe(world.user!.name);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

Then(
  "the address of the balances page of {string} has no settle parameter",
  async ({ page, world }, space: string) => {
    await expect(page).toHaveURL(new RegExp(`/spaces/${spaceId(world, space)}/balances$`));
  },
);

Then("reloading the page leaves the settle-up sheet closed", async ({ page, world }) => {
  await page.reload();
  await expect(page.getByRole("heading", { level: 2, name: world.t("balances.suggestions") })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

When("{string} chooses {string} on the home page", async ({ page, world }, name: string, action: string) => {
  expect(name).toBe(world.user!.name);
  expect(action).toBe(world.t("home.invite"));
  await page.getByRole("link", { name: action, exact: true }).click();
});

Then("the invite sheet of {string} is open on the members screen", async ({ page, world }, space: string) => {
  await expect(
    page.getByRole("dialog", { name: world.t("members.inviteSheet.title", { space }) }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/spaces/${spaceId(world, space)}/members\\?invite=1$`));
});

When(
  "{string} chooses {string} on the Saldos screen",
  async ({ page, world }, name: string, action: string) => {
    expect(name).toBe(world.user!.name);
    expect(action).toBe(world.t("home.members"));
    await page.getByRole("link", { name: action, exact: true }).click();
  },
);

Given("the browser asks for English", async ({ page, world }) => {
  await page.context().setExtraHTTPHeaders(world.headers({ "accept-language": "en-US,en;q=0.9" }));
});

When("{string} types the amount {int}", async ({ page, world }, name: string, amount: number) => {
  expect(name).toBe(world.user!.name);
  await page.getByLabel(world.t("ledger.form.amount")).pressSequentially(String(amount));
});

Then("the amount field reads {string}", async ({ page, world }, text: string) => {
  await expect(page.getByLabel(world.t("ledger.form.amount"))).toHaveValue(text);
});

Then("the home of {string} welcomes the visitor once", async ({ page, world }, space: string) => {
  const notice = page.locator("main").getByRole("status");
  await expect(notice).toContainText(world.t("spaces.joined.title", { space }));
  await notice.getByRole("link", { name: world.t("ledger.saved.dismiss") }).click();
  await expect(page).toHaveURL(new RegExp(`/spaces/${world.spaces.get(space)}$`));
  await expect(page.locator("main").getByRole("status")).toHaveCount(0);
});
