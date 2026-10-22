import { expect } from "@playwright/test";
import { BASE_URL } from "../support/base-url";
import { Given, Then, When } from "../support/fixtures";

const MENU_ITEMS: Record<string, string> = { "Sign out": "shell.profile.signOut" };

Given("a visitor on the sign-up screen", async ({ page }) => {
  await page.goto("/sign-up");
});

When(
  "the visitor enters the name {string}, the email {string} and a 12-character password and submits",
  async ({ page, world }, name: string, email: string) => {
    await page.getByLabel(world.t("auth.signUp.name")).fill(name);
    await page.getByLabel(world.t("auth.email")).fill(world.email(email));
    // Exact, because "Confirmar contraseña" also contains "contraseña" (ruling P147).
    await page.getByLabel(world.t("auth.password"), { exact: true }).fill("123456789012");
    await page.getByLabel(world.t("auth.signUp.confirmPassword"), { exact: true }).fill("123456789012");
    await page.getByRole("button", { name: world.t("auth.signUp.submit") }).click();
  },
);

Then("the visitor lands on the home page of her personal space", async ({ page, world }) => {
  await expect(page).toHaveURL(/\/spaces\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: world.t("home.title") })).toBeAttached();
});

Then(
  "the shell shows {string} in the user menu and the personal space in the space switcher",
  async ({ page, world }, name: string) => {
    await expect(page.getByRole("button", { name: world.t("shell.profile.open", { name }) })).toBeVisible();
    await expect(
      page.getByRole("button", { name: world.t("shell.space.current", { name: "Personal" }) }),
    ).toBeVisible();
  },
);

Given("{string} is signed in", async ({ page, world }, name: string) => {
  await world.signUp(name);
  await page.goto("/");
});

When("{string} chooses {string} in the user menu", async ({ page, world }, name: string, item: string) => {
  await page.getByRole("button", { name: world.t("shell.profile.open", { name }) }).click();
  await page.getByRole("button", { name: world.t(MENU_ITEMS[item]!) }).click();
});

Then("the sign-in screen is shown", async ({ page, world }) => {
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("heading", { level: 1, name: world.t("auth.signIn.title") })).toBeVisible();
});

Then("opening the home page again redirects to the sign-in screen", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
});

Given("a visitor whose browser sends no supported language preference", async ({ page, world }) => {
  await page.context().setExtraHTTPHeaders(world.headers({ "accept-language": "fr-FR,fr;q=0.9" }));
});

When("the visitor opens the sign-in page", async ({ page }) => {
  await page.goto("/sign-in");
});

Then("the page is rendered in Spanish", async ({ page, world }) => {
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(world.t("auth.signIn.title"));
});

Given(
  "a visitor without a session opens the transactions page of her personal space",
  async ({ page, playwright, world }) => {
    // Ana signs up in a separate request context, so the page itself carries no session cookie.
    const outside = await playwright.request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: world.headers(),
    });
    const email = world.email("ana@example.com");
    const signUp = await outside.post("/api/v1/auth/sign-up", {
      data: { name: "Ana", email, password: "123456789012", timezone: "America/Bogota" },
    });
    expect(signUp.ok()).toBe(true);
    const { items } = (await (await outside.get("/api/v1/spaces")).json()) as {
      items: { id: string; kind: string }[];
    };
    world.user = { name: "Ana", email, spaceId: items.find((s) => s.kind === "PERSONAL")!.id };
    await outside.dispose();
    await page.goto(`/spaces/${world.user!.spaceId}/transactions`);
  },
);

When(
  "the visitor is redirected to the sign-in screen and signs in as {string}",
  async ({ page, world }, email: string) => {
    await expect(page).toHaveURL(
      `/sign-in?next=${encodeURIComponent(`/spaces/${world.user!.spaceId}/transactions`)}`,
    );
    await page.getByLabel(world.t("auth.email")).fill(world.email(email));
    await page.getByLabel(world.t("auth.password")).fill("123456789012");
    await page.getByRole("button", { name: world.t("auth.signIn.submit") }).click();
  },
);

Then("the transactions page of her personal space is shown", async ({ page, world }) => {
  await expect(page).toHaveURL(`/spaces/${world.user!.spaceId}/transactions`);
  await expect(page.getByRole("heading", { level: 1, name: world.t("ledger.list.title") })).toBeVisible();
});
