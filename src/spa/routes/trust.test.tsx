import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { axeViolations } from "../../../tests/support/ui/axe";
import { householdSpace, meDto, spaceDto } from "../../../tests/support/ui/dto";
import { jsonResponse, problemResponse, type FakeHandler } from "../../../tests/support/ui/fake-api";
import { renderSpa } from "../../../tests/support/ui/spa";

const visitor = (): Record<string, FakeHandler> => ({
  "GET /api/v1/me": () => problemResponse(401, "Unauthenticated"),
  "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
});

const signedIn = (): Record<string, FakeHandler> => ({
  "GET /api/v1/me": () => jsonResponse(meDto()),
  "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto(), householdSpace()] }),
  "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
});

/** The owner's copy, approved on 2026-11-02 (ruling P290), word for word. */
const POINTS = [
  "Hearth no se conecta a tu banco ni mueve plata. Solo guarda lo que tú registras.",
  "Tus datos viven en el servidor de tu instalación, no en una nube de terceros.",
  "Tu espacio personal solo lo ves tú. En un espacio compartido, ven sus miembros; un Lector puede ver pero no cambiar nada.",
  "Nada se borra de verdad. Un movimiento borrado se puede recuperar y cada cambio de plata queda registrado.",
  "Cada noche se guarda una copia de todo, y se conservan las de los últimos 14 días. Esas copias están en el mismo servidor: quien lo administra puede guardar una aparte.",
];

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
});

describe("the trust page, Lo que tienes que saber (issue #146, ruling P290)", () => {
  it("opens for a visitor without a session, says the five points and goes back to sign-up", async () => {
    const spa = renderSpa("/trust", visitor());
    expect(await screen.findByRole("heading", { level: 1, name: "Lo que tienes que saber" })).toBeVisible();
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(POINTS);
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/sign-up");
    expect(document.title).toBe("Lo que tienes que saber · Hearth");
    expect(spa.location()).toBe("/trust");
    expect(await axeViolations(spa.container)).toEqual([]);
  });

  it("takes a visitor back to sign-up with where they were going and the invitation they hold", async () => {
    renderSpa(`/trust?next=${encodeURIComponent("/invitations/tok-1")}&invitation=tok-1`, visitor());
    expect(await screen.findByRole("heading", { level: 1, name: "Lo que tienes que saber" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute(
      "href",
      `/sign-up?next=${encodeURIComponent("/invitations/tok-1")}&invitation=tok-1`,
    );
  });

  it("keeps a signed-in person on the page and takes them back to Ajustes of the space they came from", async () => {
    const spa = renderSpa("/trust?from=sp-household", signedIn());
    expect(await screen.findByRole("heading", { level: 1, name: "Lo que tienes que saber" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute(
      "href",
      "/settings?from=sp-household",
    );
    expect(spa.location()).toBe("/trust?from=sp-household");
    expect(await axeViolations(spa.container)).toEqual([]);
  });

  it("never carries a ?from= that is not one of the person's own spaces back to Ajustes", async () => {
    renderSpa(`/trust?from=${encodeURIComponent("//evil.example")}`, signedIn());
    expect(await screen.findByRole("heading", { level: 1, name: "Lo que tienes que saber" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/settings");
  });

  it("speaks English with its English catalog", async () => {
    document.cookie = "hearth.locale=en; path=/";
    renderSpa("/trust", visitor());
    expect(await screen.findByRole("heading", { level: 1, name: "What you need to know" })).toBeVisible();
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(5);
  });

  it("is linked from the sign-up form, keeping where the visitor was going and the invitation", async () => {
    renderSpa(`/sign-up?next=${encodeURIComponent("/invitations/tok-1")}&invitation=tok-1`, visitor());
    expect(await screen.findByRole("link", { name: "Lo que tienes que saber" })).toHaveAttribute(
      "href",
      `/trust?next=${encodeURIComponent("/invitations/tok-1")}&invitation=tok-1`,
    );
  });

  it("is linked from Ajustes, with the space the person came from", async () => {
    renderSpa("/settings?from=sp-household", signedIn());
    expect(await screen.findByRole("link", { name: "Lo que tienes que saber" })).toHaveAttribute(
      "href",
      "/trust?from=sp-household",
    );
  });
});
