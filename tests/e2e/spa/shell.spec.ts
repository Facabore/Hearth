import { randomInt } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, request, test, type Page } from "@playwright/test";
import es from "../../../src/i18n/messages/es.json" with { type: "json" };
import { BASE_URL } from "../support/base-url";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const PASSWORD = "123456789012";

/** A fresh person, signed up over the API on the Next.js server (the SPA shares its origin's session and API). */
const signUpOverApi = async (ip: string): Promise<{ email: string; spaceId: string }> => {
  const api = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { "x-forwarded-for": ip } });
  const email = `spa-${Date.now()}-${randomInt(1e6)}@example.com`;
  const signUp = await api.post("/api/v1/auth/sign-up", {
    data: { name: "Ana", email, password: PASSWORD, timezone: "America/Bogota" },
  });
  expect(signUp.ok()).toBe(true);
  const { items } = (await (await api.get("/api/v1/spaces")).json()) as {
    items: { id: string; kind: string }[];
  };
  await api.dispose();
  return { email, spaceId: items.find((space) => space.kind === "PERSONAL")!.id };
};

const scan = async (page: Page, where: string) => {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(
    violations.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
};

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`the single-page app at /app/ in ${colorScheme} (ADR 0006, slice 1 of #199)`, () => {
    test.use({ colorScheme });

    test("a protected screen sends the visitor to sign in, then opens the shell where they were going", async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        // The guard's profile read answers 401 before signing in: that one is expected.
        if (message.type() === "error" && !/ 401 /.test(message.text())) errors.push(message.text());
      });
      const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
      await page.context().setExtraHTTPHeaders({ "x-forwarded-for": ip });
      const { email, spaceId } = await signUpOverApi(ip);

      await page.goto(`/app/spaces/${spaceId}`);
      await expect(page).toHaveURL(`/app/sign-in?next=${encodeURIComponent(`/spaces/${spaceId}`)}`);
      await expect(page.getByRole("heading", { name: es.auth.signIn.title })).toBeVisible();
      await expect(page).toHaveTitle(`${es.auth.signIn.title} · Hearth`);
      await scan(page, "sign-in");

      await page.getByLabel(es.auth.email).fill(email);
      await page.getByLabel(es.auth.password).fill(PASSWORD);
      await page.getByRole("button", { name: es.auth.signIn.submit }).click();

      await expect(page).toHaveURL(`/app/spaces/${spaceId}`);
      const nav = page.getByRole("navigation", { name: es.shell.nav.main });
      await expect(nav.getByRole("link", { name: es.shell.nav.home })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(nav.getByRole("link", { name: es.shell.nav.transactions })).toHaveAttribute(
        "href",
        `/app/spaces/${spaceId}/transactions`,
      );
      await expect(page.getByRole("button", { name: /Personal/ })).toBeVisible();
      await scan(page, "shell");

      // A deep link loads the app's page from the server and paints the shell from the cookie session.
      await page.reload();
      await expect(nav.getByRole("link", { name: es.shell.nav.home })).toBeVisible();
      // An unknown address stays inside the app, on its own not-found screen.
      await page.goto("/app/nowhere");
      await expect(page.getByRole("heading", { name: es.notFound.title })).toBeVisible();
      await scan(page, "not-found");

      expect(errors).toEqual([]);
    });
  });
}
