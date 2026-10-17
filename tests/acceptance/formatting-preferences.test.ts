import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getMe } from "@/app/api/v1/me/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, registerUser, startTestApp, type TestUser } from "../support/app";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface Formats {
  numberFormat: string;
  timeFormat: string;
  dateFormat: string;
  weekStart: string;
}
interface Me {
  locale: string;
  timezone: string;
  preferences: {
    stored: Record<keyof Formats, string | null>;
    effective: Formats;
    defaults: Formats;
    locked: string[];
  };
}
const RULES = { numberFormat: "DOT_COMMA", timeFormat: "H24", dateFormat: "DMY", weekStart: "MONDAY" };
const NONE = { numberFormat: null, timeFormat: null, dateFormat: null, weekStart: null };
const me = async (user: TestUser) => (await (await call(getMe, "GET", "/api/v1/me", { user })).json()) as Me;

describe("formatting preferences (HU-E1-15)", () => {
  it("follow the installation rules without an override, with nothing locked", async () => {
    const ana = await registerUser("Ana");
    expect(await me(ana)).toMatchObject({
      locale: "es",
      preferences: { stored: NONE, effective: RULES, defaults: RULES, locked: [] },
    });
  });
});
