import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../tests/support/ui/axe";
import { householdSpace, meDto, spaceDto } from "../../tests/support/ui/dto";
import { jsonResponse, problemResponse, type FakeHandler } from "../../tests/support/ui/fake-api";
import { renderSpa } from "../../tests/support/ui/spa";

const KEY = "hearth.referral";
const MINE = {
  code: "fabian-7k2qx9mt",
  link: "http://hearth.test/r/fabian-7k2qx9mt",
  points: 3,
  items: [
    { firstName: "Andrés", joinedOn: "2026-11-12", counts: true },
    { firstName: "Yuberley", joinedOn: "2026-11-09", counts: true },
    { firstName: "Roger", joinedOn: "2026-11-02", counts: true },
  ],
};

/** A visitor until `signUp` answers, then Ana; `claims` keeps the codes the new account claimed. */
const visitor = (preview: FakeHandler = () => jsonResponse({ firstName: "Fabián" })) => {
  let session = false;
  const claims: unknown[] = [];
  const routes: Record<string, FakeHandler> = {
    "GET /api/v1/me": () => (session ? jsonResponse(meDto()) : problemResponse(401, "Unauthenticated")),
    "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
    "GET /api/v1/referrals/{code}": preview,
    "POST /api/v1/auth/sign-up": () => ((session = true), jsonResponse({ user: meDto() }, 201)),
    "POST /api/v1/me/referrer": async (request) => {
      claims.push(((await request.json()) as { code: unknown }).code);
      return new Response(null, { status: 204 });
    },
    "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto()] }),
    "GET /api/v1/me/referrals": () => jsonResponse(MINE),
  };
  return { routes, claims };
};

const signedIn = (spaces = [spaceDto(), householdSpace()]): Record<string, FakeHandler> => ({
  "GET /api/v1/me": () => jsonResponse(meDto()),
  "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
  "GET /api/v1/spaces": () => jsonResponse({ items: spaces }),
  "GET /api/v1/me/referrals": () => jsonResponse(MINE),
});

const signUp = async () => {
  await userEvent.type(screen.getByLabelText("Nombre"), "Ana");
  await userEvent.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
  await userEvent.type(screen.getByLabelText("Contraseña"), "123456789012");
  await userEvent.type(screen.getByLabelText("Confirmar contraseña"), "123456789012");
  await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
};

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("a referral link (D27)", () => {
  it("remembers the code, opens sign-up naming the referrer, and claims it once the account exists", async () => {
    const { routes, claims } = visitor();
    const spa = renderSpa("/r/fabian-7k2qx9mt", routes);
    expect(await screen.findByText("Fabián te invitó a Hearth")).toBeVisible();
    expect(spa.location()).toBe("/sign-up");
    expect(localStorage.getItem(KEY)).toBe("fabian-7k2qx9mt");
    expect(await axeViolations(spa.container)).toEqual([]);
    await signUp();
    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-personal"));
    expect(claims).toEqual(["fabian-7k2qx9mt"]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("shows no chip for a code the API does not know, and the refused claim says nothing", async () => {
    const { routes, claims } = visitor(() => problemResponse(404, "ReferralCodeNotFound"));
    routes["POST /api/v1/me/referrer"] = async (request) => {
      claims.push(((await request.json()) as { code: unknown }).code);
      return problemResponse(404, "ReferralCodeNotFound");
    };
    const spa = renderSpa("/r/nobody-23456789", routes);
    expect(await screen.findByRole("heading", { name: "Crea tu cuenta" })).toBeVisible();
    expect(screen.queryByText(/te invitó a Hearth/)).toBeNull();
    await signUp();
    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-personal"));
    expect(claims).toEqual(["nobody-23456789"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("signs up without a link as before: no preview, no claim", async () => {
    const { routes } = visitor();
    const spa = renderSpa("/sign-up", routes);
    expect(await screen.findByRole("heading", { name: "Crea tu cuenta" })).toBeVisible();
    expect(screen.queryByText(/te invitó a Hearth/)).toBeNull();
    await signUp();
    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-personal"));
    const paths = spa.requests.map((r) => `${r.method} ${new URL(r.url).pathname}`);
    expect(paths.filter((p) => p.includes("referr"))).toEqual([]);
  });

  it("still opens sign-up when the device keeps nothing", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { routes, claims } = visitor();
    const spa = renderSpa("/r/fabian-7k2qx9mt", routes);
    expect(await screen.findByRole("heading", { name: "Crea tu cuenta" })).toBeVisible();
    expect(spa.location()).toBe("/sign-up");
    await signUp();
    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-personal"));
    expect(claims).toEqual([]);
  });

  it("sends a signed-in person home and remembers nothing", async () => {
    const spa = renderSpa("/r/fabian-7k2qx9mt", signedIn());
    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-personal"));
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
