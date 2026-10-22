import { createBdd, test as base } from "playwright-bdd";
import { World } from "./world";

let tests = 0;

/** Each test is one visitor with its own address, so the sign-up and sign-in throttles never meet (ruling P133). */
export const test = base.extend<{ world: World }>({
  world: async ({ page, playwright }, use, testInfo) => {
    tests += 1;
    const ip = `10.${testInfo.workerIndex % 250}.${Math.floor(tests / 250) % 250}.${(tests % 250) + 1}`;
    const world = new World(page, testInfo.testId, ip, playwright.request);
    await page.context().setExtraHTTPHeaders(world.headers());
    await use(world);
    await world.dispose();
  },
});

export const { Given, When, Then } = createBdd(test);
