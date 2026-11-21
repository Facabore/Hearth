import { randomInt } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { E2E_NOW, test } from "../support/clock";
import { es } from "../../../src/i18n/messages/full";
import { get, post, signUp } from "../support/seed";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const scan = async (page: Page, where: string) => {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(
    violations.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
};

test.describe("a new category from Registrar (ruling P308, #272)", () => {
  test("Juan, a MEMBER of Viaje, creates a category there from the picker, records in it, and Ana shares it", async ({
    page,
    browser,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
    await signUp(page, "spa-newcat-ana", ip);
    const trip = (await post(page, "/api/v1/spaces", { kind: "SHARED", name: "Viaje", currency: "COP" })) as {
      id: string;
    };
    const { url } = (await post(page, `/api/v1/spaces/${trip.id}/invitations`, {
      kind: "LINK",
      role: "MEMBER",
    })) as { url: string };
    const token = new URL(url, "http://hearth.invalid").pathname.split("/").filter(Boolean).at(-1)!;

    // Juan, in a browser of his own, joins Viaje as a MEMBER, who does not manage its categories.
    const juanContext = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      extraHTTPHeaders: { "x-forwarded-for": ip },
    });
    // The same fixed clock as the default context, so his expense falls in the server's period.
    await juanContext.clock.setFixedTime(E2E_NOW);
    const juan = await juanContext.newPage();
    juan.on("pageerror", (error) => errors.push(error.message));
    const signedUp = await juan.request.post("/api/v1/auth/sign-up", {
      data: {
        name: "Juan",
        email: `spa-newcat-juan-${Date.now()}-${randomInt(1e6)}@example.com`,
        password: "123456789012",
        timezone: "America/Bogota",
      },
      headers: { "x-forwarded-for": ip },
    });
    expect(signedUp.ok()).toBe(true);
    await juan.goto(`/invitations/${token}`);
    await juan.getByRole("button", { name: "Aceptar y entrar a Viaje" }).click();
    await expect(juan).toHaveURL(`/spaces/${trip.id}?joined=1`);

    // Registrar names its space first, and the picker says whose categories it shows.
    await juan.goto(`/spaces/${trip.id}/new`);
    await expect(juan.getByText(es.ledger.form.recordIn)).toBeVisible();
    await juan.getByLabel(es.ledger.form.amount).pressSequentially("45000");
    await juan.getByRole("button", { name: es.ledger.form.chooseCategory }).click();
    const picker = juan.getByRole("dialog", { name: es.categories.picker.title });
    await expect(picker.getByText("Categorías de Viaje")).toBeVisible();
    await picker.getByRole("button", { name: es.categories.picker.new }).click();
    const sheet = juan.getByRole("dialog", { name: es.categories.picker.new });
    await expect(sheet.getByText("En Viaje · la verán todos en el espacio")).toBeVisible();
    await sheet.getByLabel(es.categories.picker.name).fill("Bebidas en el hotel");
    await scan(juan, "new category");
    await sheet.getByRole("button", { name: "Crear y usar en el gasto" }).click();
    await expect(sheet).toBeHidden();

    // The new category is chosen and the amount kept; saving records the expense in it.
    await expect(juan.getByRole("button", { name: "Bebidas en el hotel" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(juan.getByLabel(es.ledger.form.amount)).toHaveValue("45.000");
    await juan.getByRole("button", { name: es.ledger.form.save.EXPENSE }).click();
    await expect(juan).toHaveURL(`/spaces/${trip.id}/transactions`);
    await juanContext.close();

    // Ana, the owner, shares the category Juan created, and the expense is in it.
    const { items: groups } = (await get(page, `/api/v1/spaces/${trip.id}/categories`)) as {
      items: { categories: { id: string; name: string }[] }[];
    };
    const drinks = groups.flatMap((g) => g.categories).find((c) => c.name === "Bebidas en el hotel");
    expect(drinks).toBeDefined();
    const { items: rows } = (await get(page, `/api/v1/spaces/${trip.id}/transactions`)) as {
      items: { categoryId: string | null }[];
    };
    expect(rows.map((row) => row.categoryId)).toContain(drinks!.id);
    expect(errors).toEqual([]);
  });
});

test.describe("the pencil on Registrar's chosen category (ruling P346, #349)", () => {
  test("Ana, who manages her space's categories, renames the chosen one from the pencil and the chip follows", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
    const spaceId = await signUp(page, "spa-pencil-ana", ip);
    const { items: groups } = (await get(page, `/api/v1/spaces/${spaceId}/categories`)) as {
      items: { categories: { key: string | null; name: string }[] }[];
    };
    const groceries = groups.flatMap((g) => g.categories).find((c) => c.key === "groceries")!;

    await page.goto(`/spaces/${spaceId}/new`);
    const chips = page.getByRole("group", { name: es.ledger.form.category });
    const chip = (name: string) => chips.getByRole("button", { name, exact: true });
    await chip(groceries.name).click();
    // P348: the category asks for the account first; the person leaves it for later.
    const who = page.getByRole("dialog", { name: es.ledger.who.title });
    await expect(who).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(who).toBeHidden();
    await expect(chip(groceries.name)).toHaveAttribute("aria-pressed", "true");
    // The sheet's words come from the categories area, which the record route loads (P276).
    await chips.getByRole("button", { name: es.categories.edit.replace("{name}", groceries.name) }).click();
    const sheet = page.getByRole("dialog", { name: es.categories.sheet.editTitle });
    await expect(sheet.getByLabel(es.categories.sheet.name)).toHaveValue(groceries.name);
    await scan(page, "edit category from Registrar");
    await sheet.getByLabel(es.categories.sheet.name).fill("Supermercado");
    await sheet.getByRole("button", { name: es.categories.sheet.save }).click();
    await expect(sheet).toBeHidden();
    await expect(chip("Supermercado")).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
  });
});
