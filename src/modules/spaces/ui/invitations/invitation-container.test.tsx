import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { meDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { ClaimPreviewDto, InvitationPreviewDto, MeDto } from "@/shared/ui/api/dto";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
const session = vi.hoisted(() => ({ api: null as unknown, me: null as unknown }));
vi.mock("@/shared/ui/api/server", async (importActual) => ({
  ...(await importActual<typeof import("@/shared/ui/api/server")>()),
  serverApi: async () => session.api as Api,
  getMe: async () => session.me as MeDto | null,
}));
const { InvitationContainer, loadPreview } = await import("./invitation-container");

const LINK: InvitationPreviewDto = {
  kind: "LINK",
  spaceName: "Household",
  role: "MEMBER",
  status: "PENDING",
  expiresAt: "2026-10-19T03:00:00.000Z",
  invitedBy: "Ana",
};
const CLAIM: ClaimPreviewDto = {
  spaceName: "Household",
  guestName: "Pedro",
  status: "PENDING",
  expiresAt: "2026-10-19T03:00:00.000Z",
  invitedBy: "Ana",
};

beforeEach(() => {
  session.me = null;
});

describe("loadPreview (ruling P156)", () => {
  it("answers the preview, or missing for a 404, through the public endpoints", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/invitations/{token}": (_, { token }) =>
        token === "tok-1" ? jsonResponse(LINK) : problemResponse(404, "InvitationNotFound"),
      "GET /api/v1/claims/{token}": () => jsonResponse(CLAIM),
    });
    expect(await loadPreview(api, { kind: "invitation", token: "tok-1" })).toEqual({
      kind: "found",
      preview: LINK,
    });
    expect(await loadPreview(api, { kind: "invitation", token: "nope" })).toEqual({ kind: "missing" });
    expect(await loadPreview(api, { kind: "claim", token: "c-1" })).toEqual({
      kind: "found",
      preview: CLAIM,
    });
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
      "/api/v1/invitations/tok-1",
      "/api/v1/invitations/nope",
      "/api/v1/claims/c-1",
    ]);
  });

  it("answers a problem for a failed read, a stray 401 and a network failure, never throwing", async () => {
    const failing = fakeApi({
      "GET /api/v1/invitations/{token}": () => problemResponse(500, "InternalError"),
    });
    expect(await loadPreview(failing.api, { kind: "invitation", token: "t" })).toMatchObject({
      kind: "problem",
      problem: { code: "InternalError", status: 500 },
    });
    const stray = fakeApi({
      "GET /api/v1/invitations/{token}": () => problemResponse(401, "Unauthenticated"),
    });
    expect(await loadPreview(stray.api, { kind: "invitation", token: "t" })).toMatchObject({
      kind: "problem",
      problem: { status: 401 },
    });
    const offline = fakeApi({
      "GET /api/v1/claims/{token}": () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await loadPreview(offline.api, { kind: "claim", token: "t" })).toMatchObject({ kind: "problem" });
  });
});

describe("InvitationContainer (ruling P157, P182)", () => {
  const open = async (kind: "invitation" | "claim", token: string) =>
    renderWithIntl(await InvitationContainer({ kind, token }));
  const api = () =>
    fakeApi({
      "GET /api/v1/invitations/{token}": (_, { token }) =>
        token === "tok-1" ? jsonResponse(LINK) : problemResponse(404, "InvitationNotFound"),
      "GET /api/v1/claims/{token}": () => jsonResponse(CLAIM),
    }).api;

  it("reads a visitor's dates in the built-in formats and the installation's zone", async () => {
    session.api = api();
    await open("invitation", "tok-1");
    expect(screen.getByRole("link", { name: "Crear cuenta y unirme" })).toBeInTheDocument();
    expect(screen.getByText("Vence").nextSibling).toHaveTextContent("18/10/2026");
  });

  it("reads a signed-in person's dates in their formats and zone, and offers to accept", async () => {
    session.api = api();
    session.me = meDto({
      email: "juan@example.com",
      timezone: "Asia/Tokyo",
      preferences: {
        ...meDto().preferences,
        effective: { numberFormat: "DOT_COMMA", dateFormat: "MDY", timeFormat: "H24", weekStart: "MONDAY" },
      },
    });
    await open("invitation", "tok-1");
    expect(screen.getByText("Vence").nextSibling).toHaveTextContent("10/19/2026");
    expect(screen.getByRole("button", { name: "Aceptar y entrar a Household" })).toBeInTheDocument();
    expect(screen.getByText(/juan@example.com/)).toBeInTheDocument();
  });

  it("opens a claim link on the claim page, and an unknown token on the missing state", async () => {
    session.api = api();
    const { unmount } = await open("claim", "c-1");
    expect(screen.getByRole("heading", { level: 1, name: "Household, como Pedro" })).toBeInTheDocument();
    unmount();
    await open("invitation", "nope");
    expect(screen.getByText("No encontramos esta invitación.")).toBeInTheDocument();
  });

  it("shows a failed read as a problem notice instead of a card", async () => {
    session.api = fakeApi({
      "GET /api/v1/invitations/{token}": () => problemResponse(500, "InternalError"),
    }).api;
    await open("invitation", "tok-1");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("No encontramos esta invitación.")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ir a Hearth" })).not.toBeInTheDocument();
  });
});
