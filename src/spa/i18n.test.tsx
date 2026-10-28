import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse, problemResponse } from "../../tests/support/ui/fake-api";
import { renderSpa } from "../../tests/support/ui/spa";

// The English catalog's chunk cannot be fetched: a flaky network, or a hashed file gone after a release.
vi.mock("@/i18n/messages/en.json", () => {
  throw new TypeError("Failed to fetch dynamically imported module");
});

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
});

describe("the app's texts", () => {
  it("keeps the texts on screen when the other language's catalog cannot load", async () => {
    const spa = renderSpa("/sign-in", {
      "GET /api/v1/me": () => problemResponse(401, "Unauthenticated"),
      "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
    });
    await screen.findByRole("heading", { name: "Hola de nuevo" });
    await userEvent.click(screen.getByRole("button", { name: "Cambiar idioma, actual español" }));
    await waitFor(() => expect(spa.queryClient.getQueryState(["i18n", "en"])?.status).toBe("error"));
    expect(screen.getByRole("heading", { name: "Hola de nuevo" })).toBeVisible();
    expect(document.documentElement.lang).toBe("es");
  });
});
