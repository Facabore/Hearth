import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../tests/support/ui/axe";
import { householdSpace, meDto, spaceDto } from "../../tests/support/ui/dto";
import { jsonResponse, problemResponse, type FakeHandler } from "../../tests/support/ui/fake-api";
import { renderSpa } from "../../tests/support/ui/spa";
import { createSpa } from "./app";
import { queryKeys } from "./queries";

const signedOut = (): Record<string, FakeHandler> => ({
  "GET /api/v1/me": () => problemResponse(401, "Unauthenticated"),
  "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
});

const signedIn = (spaces = [spaceDto(), householdSpace()]): Record<string, FakeHandler> => ({
  "GET /api/v1/me": () => jsonResponse(meDto()),
  "GET /api/v1/spaces": () => jsonResponse({ items: spaces }),
  "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
});

// jsdom reads as an English browser; the e2e browser, like most visitors, is Spanish (es-CO).
beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
});

afterEach(() => vi.unstubAllGlobals());

describe("route guards (HU-E9-01, src/proxy.ts in the SPA)", () => {
  it("sends a protected path without a session to the sign-in screen with the path and query to return to", async () => {
    const spa = renderSpa("/spaces/sp-personal/transactions?tx=t1", signedOut());
    expect(await screen.findByRole("heading", { name: "Hola de nuevo" })).toBeVisible();
    expect(spa.location()).toBe(
      `/sign-in?next=${encodeURIComponent("/spaces/sp-personal/transactions?tx=t1")}`,
    );
    expect(spa.browserHref()).toBe(
      `/sign-in?next=${encodeURIComponent("/spaces/sp-personal/transactions?tx=t1")}`,
    );
  });

  it("sends the app's root without a session to the bare sign-in screen", async () => {
    const spa = renderSpa("/", signedOut());
    await screen.findByRole("heading", { name: "Hola de nuevo" });
    expect(spa.location()).toBe("/sign-in");
  });

  it("lets a visitor stay on the sign-up screen, with sign-up's own mode", async () => {
    const spa = renderSpa("/sign-up", {
      ...signedOut(),
      "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "closed" }),
    });
    await screen.findByRole("heading", { name: "El registro está cerrado" });
    expect(screen.getByRole("link", { name: "Inicia sesión" })).toHaveAttribute("href", "/sign-in");
    expect(spa.location()).toBe("/sign-up");
    expect(screen.queryByLabelText("Contraseña")).toBeNull();
  });

  it("sends a signed-in person on the sign-in screen on to the screen `next` names", async () => {
    const spa = renderSpa(`/sign-in?next=${encodeURIComponent("/spaces/sp-household")}`, signedIn());
    expect(await screen.findByRole("button", { name: /Household/ })).toBeVisible();
    expect(spa.location()).toBe("/spaces/sp-household");
  });

  it("never follows a `next` that leaves the app's origin (ruling P125): it opens the personal space", async () => {
    const spa = renderSpa(`/sign-in?next=${encodeURIComponent("//evil.example/x")}`, signedIn());
    await screen.findByRole("button", { name: /Personal/ });
    expect(spa.location()).toBe("/spaces/sp-personal");
  });

  it("gives a space the person is not in, and an unknown address, the app's own not-found screen", async () => {
    renderSpa("/spaces/sp-stranger", signedIn());
    expect(await screen.findByRole("heading", { name: "Esta página no existe" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Ir al inicio" })).toHaveAttribute("href", "/");
  });

  it("gives an unknown address the not-found screen too", async () => {
    renderSpa("/nowhere/at/all", signedIn());
    expect(await screen.findByRole("heading", { name: "Esta página no existe" })).toBeVisible();
    expect(document.title).toBe("Esta página no existe · Hearth");
  });
});

describe("sign-in to the app shell", () => {
  it("signs in, opens the personal space's shell and returns there without a new session read per tap", async () => {
    let session = false;
    const spa = renderSpa("/spaces/sp-household", {
      ...signedIn(),
      "GET /api/v1/me": () => (session ? jsonResponse(meDto()) : problemResponse(401, "Unauthenticated")),
      "POST /api/v1/auth/sign-in": () => ((session = true), jsonResponse({ user: meDto(), token: "t" })),
    });
    const { container } = spa;
    await screen.findByRole("heading", { name: "Hola de nuevo" });
    expect(await axeViolations(container)).toEqual([]);
    await userEvent.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Contraseña"), "123456789012");
    await userEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(await screen.findByRole("button", { name: /Household/ })).toBeVisible();
    expect(spa.location()).toBe("/spaces/sp-household");
    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(within(nav).getByRole("link", { name: "Inicio" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Movimientos" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/transactions",
    );
    expect(await axeViolations(container)).toEqual([]);

    // A tap between screens the session already allows reads no session again.
    const reads = spa.requests.filter((r) => new URL(r.url).pathname === "/api/v1/me").length;
    await userEvent.click(screen.getByRole("button", { name: /Household/ }));
    await userEvent.click(await screen.findByRole("link", { name: /Personal/ }));
    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-personal"));
    expect(spa.requests.filter((r) => new URL(r.url).pathname === "/api/v1/me")).toHaveLength(reads);
  });

  it("drops the previous person's answers from the cache when the session changes", async () => {
    let session = true;
    const spa = renderSpa("/spaces/sp-personal", {
      ...signedIn(),
      "GET /api/v1/me": () => (session ? jsonResponse(meDto()) : problemResponse(401, "Unauthenticated")),
    });
    await screen.findByRole("button", { name: /Personal/ });
    expect(spa.queryClient.getQueryData(queryKeys.spaces)).toHaveLength(2);
    session = false;
    await spa.router.navigate({ href: "/sign-in" });
    await screen.findByRole("heading", { name: "Hola de nuevo" });
    expect(spa.queryClient.getQueryData(queryKeys.spaces)).toBeUndefined();
  });

  it("switches the texts in place when the visitor changes the language", async () => {
    renderSpa("/sign-in", signedOut());
    await screen.findByRole("heading", { name: "Hola de nuevo" });
    await userEvent.click(screen.getByRole("button", { name: "Cambiar idioma, actual español" }));
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeVisible();
    expect(document.documentElement.lang).toBe("en");
  });

  it("speaks the signed-in person's stored language, whatever the visitor cookie says", async () => {
    renderSpa("/spaces/sp-personal", {
      ...signedIn(),
      "GET /api/v1/me": () => jsonResponse(meDto({ locale: "en" })),
    });
    expect(await screen.findByRole("navigation", { name: "Main" })).toBeVisible();
  });
});

describe("a session that ends while the app is open (ruling P151)", () => {
  it("goes to this app's sign-in screen, saying why, and keeps the screen to return to", async () => {
    let session = true;
    vi.stubGlobal("fetch", async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path === "/api/v1/me")
        return session ? jsonResponse(meDto()) : problemResponse(401, "Unauthenticated");
      if (path === "/api/v1/spaces")
        return session ? jsonResponse({ items: [spaceDto()] }) : problemResponse(401, "Unauthenticated");
      return jsonResponse({ signUp: "open" });
    });
    const history = createMemoryHistory({ initialEntries: ["/spaces/sp-personal"] });
    const spa = createSpa({ history });
    render(<spa.Spa />);
    await screen.findByRole("button", { name: /Personal/ });
    session = false;
    await spa.queryClient.refetchQueries({ queryKey: queryKeys.spaces });
    expect(await screen.findByText("Tu sesión venció. Vuelve a entrar.")).toBeVisible();
    expect(spa.router.state.location.href).toBe(
      `/sign-in?next=${encodeURIComponent("/spaces/sp-personal")}&expired=1`,
    );
    expect(history.location.pathname).toBe("/sign-in");
  });
});

describe("recovering and leaving", () => {
  it("loads the screen again on Reintentar after its load failed (N2)", async () => {
    let failures = 2;
    renderSpa("/spaces/sp-personal", {
      ...signedIn(),
      "GET /api/v1/spaces": () =>
        failures-- > 0 ? problemResponse(500, "Internal") : jsonResponse({ items: [spaceDto()] }),
    });
    expect(await screen.findByRole("heading", { name: "Algo salió mal" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("button", { name: /Personal/ })).toBeVisible();
  });

  it("signs out to the sign-in screen and keeps none of the person's answers", async () => {
    let session = true;
    // The profile sheet signs out through the app's own client, like every component inside the SPA.
    const spa = renderSpa("/spaces/sp-personal", {
      ...signedIn(),
      "GET /api/v1/me": () => (session ? jsonResponse(meDto()) : problemResponse(401, "Unauthenticated")),
      "POST /api/v1/auth/sign-out": () => {
        session = false;
        return new Response(null, { status: 204 });
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: "Perfil de Ana" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByRole("heading", { name: "Hola de nuevo" })).toBeVisible();
    expect(spa.location()).toBe("/sign-in");
    expect(spa.queryClient.getQueryData(queryKeys.spaces)).toBeUndefined();
  });
});
