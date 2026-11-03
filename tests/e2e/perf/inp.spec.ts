import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import budgets from "../../performance/budgets.json" with { type: "json" };
import { chooseCategory } from "../support/record";

const WEB_VITALS = createRequire(import.meta.url).resolve("web-vitals"); // dist/web-vitals.umd.cjs: window.webVitals

test("INP stays within budget over the record flow on a 4× slower CPU (ruling P134)", async ({ page }) => {
  await page.request.post("/api/v1/auth/sign-up", {
    headers: { "x-forwarded-for": "10.251.0.1" },
    data: {
      name: "Inp",
      email: `inp-${Date.now()}@example.com`,
      password: "123456789012",
      timezone: "America/Bogota",
    },
  });
  const {
    items: [space],
  } = await (await page.request.get("/api/v1/spaces")).json();
  await page.request.post(`/api/v1/spaces/${space.id}/accounts`, {
    data: { name: "Bancolombia", type: "BANK", openingBalance: { amount: "0", currency: "COP" } },
  });
  await page.addInitScript({ path: WEB_VITALS });
  await page.addInitScript(() => {
    (window as unknown as { __inp: number }).__inp = 0;
    addEventListener("load", () =>
      (
        window as unknown as { webVitals: { onINP: (cb: (m: { value: number }) => void, o: object) => void } }
      ).webVitals.onINP(
        (metric) => {
          (window as unknown as { __inp: number }).__inp = metric.value;
        },
        { reportAllChanges: true, durationThreshold: 16 },
      ),
    );
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto(`/spaces/${space.id}/new`);
  await expect(page.locator("[data-ready='true']")).toBeAttached();
  await page.locator("#record-amount").pressSequentially("85");
  // Ruling P291: the keypad writes into the amount too.
  await page.getByRole("button", { name: "000", exact: true }).click();
  await chooseCategory(page, /./);
  await page.getByTestId("when-chip").click();
  await page.getByRole("button", { name: "Una hora menos" }).click();
  await page.keyboard.press("Escape");
  const inp = await page.evaluate(() => (window as unknown as { __inp: number }).__inp);
  console.log(`INP ${inp} ms (budget ${budgets.metrics.inpMs} ms)`);
  expect(inp).toBeGreaterThan(0);
  expect(inp).toBeLessThanOrEqual(budgets.metrics.inpMs);
});
