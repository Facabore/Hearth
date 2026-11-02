import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { axeViolations } from "../../../tests/support/ui/axe";
import { meDto } from "../../../tests/support/ui/dto";
import { jsonResponse, problemResponse, type FakeHandler } from "../../../tests/support/ui/fake-api";
import { renderSpa } from "../../../tests/support/ui/spa";

const signedIn = (verify: FakeHandler): Record<string, FakeHandler> => ({
  "GET /api/v1/me": () => jsonResponse(meDto()),
  "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
  "POST /api/v1/auth/verify-email": verify,
});

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
});

describe("the email verification screen (issue #86, ruling P283)", () => {
  it("sends the link's token to the API once and says the address is confirmed, with a way back", async () => {
    const tokens: unknown[] = [];
    const spa = renderSpa(
      "/verify-email?token=tok-123",
      signedIn(async (request) => {
        tokens.push(((await request.json()) as { token: unknown }).token);
        return new Response(null, { status: 204 });
      }),
    );
    expect(await screen.findByRole("heading", { name: "Tu correo quedó confirmado" })).toBeVisible();
    expect(
      screen.getByText(
        "Ya puedes aceptar las invitaciones que te enviaron a este correo. Abre otra vez la invitación para unirte.",
      ),
    ).toBeVisible();
    expect(tokens).toEqual(["tok-123"]);
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Ir a Hearth" })).toHaveAttribute("href", "/");
    expect(document.title).toBe("Confirmar tu correo · Hearth");
    expect(spa.location()).toBe("/verify-email?token=tok-123");
    expect(await axeViolations(spa.container)).toEqual([]);
  });

  it("says why a link the API refuses did not work", async () => {
    renderSpa(
      "/verify-email?token=expired",
      signedIn(() => problemResponse(422, "InvalidVerificationLink")),
    );
    expect(await screen.findByRole("heading", { name: "No pudimos confirmar tu correo" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Este enlace para confirmar tu correo ya no sirve. Abre otra vez la invitación y acéptala: te enviamos uno nuevo.",
    );
  });

  it("never calls the API for a link without its token", async () => {
    const spa = renderSpa(
      "/verify-email",
      signedIn(() => new Response(null, { status: 204 })),
    );
    expect(await screen.findByRole("heading", { name: "No pudimos confirmar tu correo" })).toBeVisible();
    expect(spa.requests.filter((r) => r.url.includes("verify-email"))).toEqual([]);
  });
});
