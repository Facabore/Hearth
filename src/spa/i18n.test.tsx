import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, problemResponse } from "../../tests/support/ui/fake-api";
import { renderSpa } from "../../tests/support/ui/spa";

const english = vi.hoisted(() => ({ loads: false }));

// The English catalog's chunk cannot be fetched: a flaky network, or a hashed file gone after a release.
vi.mock("@/i18n/messages/en.json", async (importOriginal) => {
  if (!english.loads) throw new TypeError("Failed to fetch dynamically imported module");
  return importOriginal();
});

const signedOut = {
  "GET /api/v1/me": () => problemResponse(401, "Unauthenticated"),
  "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
};

beforeEach(() => {
  english.loads = false;
  document.cookie = "hearth.locale=es; path=/";
});

describe("the app's texts", () => {
  it("keeps the texts on screen when the other language's catalog cannot load", async () => {
    const spa = renderSpa("/sign-in", signedOut);
    await screen.findByRole("heading", { name: "Hola de nuevo" });
    await userEvent.click(screen.getByRole("button", { name: "Cambiar idioma, actual español" }));
    await waitFor(() => expect(spa.queryClient.getQueryState(["i18n", "en"])?.status).toBe("error"));
    expect(screen.getByRole("heading", { name: "Hola de nuevo" })).toBeVisible();
    expect(document.documentElement.lang).toBe("es");
  });

  it("says so, in the visitor's language, when the first catalog cannot load, and loads it again on Try again", async () => {
    document.cookie = "hearth.locale=en; path=/";
    renderSpa("/sign-in", signedOut);
    expect(
      await screen.findByRole("heading", { name: "We couldn't load Hearth" }, { timeout: 5_000 }),
    ).toBeVisible();
    expect(screen.getByText("Check your connection and try again.")).toBeVisible();
    english.loads = true;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "We couldn't load Hearth" })).toBeNull();
  });
});
