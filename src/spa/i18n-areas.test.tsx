import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import planEn from "@/i18n/messages/areas/plan.en.json";
import planEs from "@/i18n/messages/areas/plan.es.json";
import settingsEs from "@/i18n/messages/areas/settings.es.json";
import coreEs from "@/i18n/messages/es.json";
import { householdSpace, meDto, spaceDto } from "../../tests/support/ui/dto";
import { jsonResponse, problemResponse } from "../../tests/support/ui/fake-api";
import { loadedAreas, renderSpa, speak, watchMissingMessages } from "../../tests/support/ui/spa";
import type { SpaApis } from "./api";
import { areaCatalogQuery, loadAreas, withAreas } from "./i18n";
import { queryKeys } from "./queries";

// The Settings area's English chunk cannot be fetched: a flaky network, or a hashed file gone after a release.
vi.mock("@/i18n/messages/areas/settings.en.json", () => {
  throw new TypeError("Failed to fetch dynamically imported module");
});

const context = (me: ReturnType<typeof meDto> | null) => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(queryKeys.me, me);
  return { queryClient, apis: {} as SpaApis };
};
const route = (areas?: readonly ("plan" | "members")[]) => ({ options: { staticData: { areas } } });

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
});

describe("an area's catalog loads with its routes (ruling P276)", () => {
  it("loads the route's areas in the profile's language, and nothing for a route without any", async () => {
    const english = context(meDto({ locale: "en" }));
    await loadAreas(english, route(["plan"]));
    expect(english.queryClient.getQueryData(["i18n", "en", "plan"])).toEqual(planEn);
    expect(english.queryClient.getQueryData(["i18n", "es", "plan"])).toBeUndefined();

    // A visitor's language is the cookie's, as the texts pick it.
    const visitor = context(null);
    await loadAreas(visitor, route(["plan"]));
    expect(visitor.queryClient.getQueryData(["i18n", "es", "plan"])).toEqual(planEs);

    const none = context(meDto());
    await loadAreas(none, route());
    expect(none.queryClient.getQueryCache().findAll({ queryKey: ["i18n"] })).toEqual([]);
  });

  it("keeps an area's catalog for good once it is in, as the core's", () => {
    expect(areaCatalogQuery("plan", "es")).toMatchObject({
      queryKey: ["i18n", "es", "plan"],
      staleTime: Infinity,
      gcTime: Infinity,
    });
  });

  it("answers a loader's data only once its areas are in, the areas started first", async () => {
    const order: string[] = [];
    let release = () => {};
    const areas = new Promise<void>((resolve) => {
      order.push("areas");
      release = resolve;
    });
    const loaded = withAreas(
      areas,
      Promise.resolve().then(() => {
        order.push("data");
        return "the data";
      }),
    );
    let answered = false;
    void loaded.then(() => (answered = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(answered).toBe(false);
    release();
    expect(await loaded).toBe("the data");
    expect(order).toEqual(["areas", "data"]);
  });
});

describe("the texts of an area on a language change (ruling P276)", () => {
  const routes = {
    "GET /api/v1/me": () => jsonResponse(meDto()),
    "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto(), householdSpace()] }),
    "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
  };

  it("keeps the screen in its language when an area's catalog in the new one cannot load", async () => {
    const english = await vi.importActual<typeof settingsEs>("@/i18n/messages/areas/settings.en.json");
    const missing = watchMissingMessages();
    const spa = renderSpa("/settings", routes);
    expect(
      await screen.findByText(settingsEs.settings.numbersAndDates, {}, { timeout: 5_000 }),
    ).toBeVisible();

    speak(spa, "en");
    await waitFor(() =>
      expect(spa.queryClient.getQueryState(["i18n", "en", "settings"])?.status).toBe("error"),
    );
    // The core catalog in English is in, but the screen keeps its Spanish texts, its area's included.
    expect(spa.queryClient.getQueryState(["i18n", "en"])?.status).toBe("success");
    expect(screen.getByText(settingsEs.settings.numbersAndDates)).toBeVisible();
    expect(screen.queryByText(english.settings.numbersAndDates)).toBeNull();
    expect(document.documentElement.lang).toBe("es");
    expect(missing()).toEqual([]);
  });

  it("downloads no area's copy for a screen of the core alone", async () => {
    const spa = renderSpa("/sign-in", {
      ...routes,
      "GET /api/v1/me": () => problemResponse(401, "Unauthenticated"),
    });
    await screen.findByRole("heading", { name: coreEs.auth.signIn.title }, { timeout: 5_000 });
    expect(loadedAreas(spa)).toEqual([]);
  });
});
