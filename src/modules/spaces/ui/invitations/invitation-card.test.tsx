import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { householdSpace } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { ClaimPreviewDto, InvitationPreviewDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { InvitationCard } from "./invitation-card";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

const LINK: InvitationPreviewDto = {
  kind: "LINK",
  spaceName: "Household",
  role: "MEMBER",
  status: "PENDING",
  expiresAt: "2026-10-19T12:00:00.000Z",
  invitedBy: "Ana",
};
const CLAIM: ClaimPreviewDto = {
  spaceName: "Household",
  guestName: "Pedro",
  status: "PENDING",
  expiresAt: "2026-10-19T12:00:00.000Z",
  invitedBy: "Ana",
};
const card = (props: Partial<ComponentProps<typeof InvitationCard>> = {}, locale: "es" | "en" = "es") =>
  renderWithIntl(
    <InvitationCard
      kind="invitation"
      token="tok-1"
      preview={LINK}
      viewer={null}
      formats={BUILT_IN_FORMATS}
      zone="America/Bogota"
      {...props}
    />,
    { locale },
  );

describe("invitation page (HU-E9-05, ruling P165)", () => {
  it("shows a visitor the space, the role and the expiry, and the way to sign up and come back", async () => {
    const { container } = card();
    expect(screen.getByText("Ana te invita a")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Household" })).toBeInTheDocument();
    expect(screen.getByText("Entras como").nextSibling).toHaveTextContent("Miembro");
    expect(screen.getByText("Vence").nextSibling).toHaveTextContent("19/10/2026");
    expect(screen.getByRole("link", { name: "Crear cuenta y unirme" })).toHaveAttribute(
      "href",
      "/sign-up?invitation=tok-1&next=%2Finvitations%2Ftok-1",
    );
    expect(screen.getByRole("link", { name: "Ya tengo cuenta: iniciar sesión" })).toHaveAttribute(
      "href",
      "/sign-in?next=%2Finvitations%2Ftok-1&invitation=tok-1",
    );
    expect(screen.getByText("Después de crear la cuenta vuelves aquí para aceptar.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("reads the expiry in the zone it is given, not in UTC", () => {
    card({ preview: { ...LINK, expiresAt: "2026-10-19T03:00:00.000Z" } });
    expect(screen.getByText("Vence").nextSibling).toHaveTextContent("18/10/2026");
  });

  it("encodes a token that is not URL-safe in both links", () => {
    card({ token: "a/b c" });
    expect(screen.getByRole("link", { name: "Crear cuenta y unirme" })).toHaveAttribute(
      "href",
      "/sign-up?invitation=a%2Fb%20c&next=%2Finvitations%2Fa%252Fb%2520c",
    );
  });

  it("lets a signed-in person accept once and enter the space", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/invitations/{token}/accept": () => jsonResponse(householdSpace({ role: "MEMBER" })),
    });
    const { container } = card({ viewer: { email: "juan@example.com" }, api });
    expect(
      screen.getByText(
        "Entraste como juan@example.com. Al aceptar, Household aparece en tu selector de espacios.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ahora no" })).toHaveAttribute("href", "/");
    expect(await axeViolations(container)).toEqual([]);
    await userEvent.dblClick(screen.getByRole("button", { name: "Aceptar y entrar a Household" }));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe("POST");
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/invitations/tok-1/accept");
    expect(router.replace).toHaveBeenCalledWith("/spaces/sp-household");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("explains an invitation for another account and offers to switch", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/invitations/{token}/accept": () => problemResponse(403, "InvitationEmailMismatch"),
      "POST /api/v1/auth/sign-out": () => new Response(null, { status: 204 }),
    });
    const { container } = card({ viewer: { email: "luis@example.com" }, api });
    await userEvent.click(screen.getByRole("button", { name: "Aceptar y entrar a Household" }));
    expect(
      await screen.findByText("Esta invitación es para otra cuenta y entraste como luis@example.com."),
    ).toBeInTheDocument();
    expect(screen.getByText("Inicia sesión con la cuenta a la que llegó la invitación.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceptar y entrar a Household" })).not.toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
    // N6: a way out that does not mean signing out.
    expect(screen.getByRole("link", { name: "Ahora no" })).toHaveAttribute("href", "/");
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión y cambiar de cuenta" }));
    expect(requests[1]!.method).toBe("POST");
    expect(new URL(requests[1]!.url).pathname).toBe("/api/v1/auth/sign-out");
    expect(router.replace).toHaveBeenCalledWith("/sign-in?next=%2Finvitations%2Ftok-1&invitation=tok-1");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("still goes to the sign-in screen when the sign-out call fails", async () => {
    const { api } = fakeApi({
      "POST /api/v1/invitations/{token}/accept": () => problemResponse(403, "InvitationEmailMismatch"),
      "POST /api/v1/auth/sign-out": () => {
        throw new TypeError("fetch failed");
      },
    });
    card({ viewer: { email: "luis@example.com" }, api });
    await userEvent.click(screen.getByRole("button", { name: "Aceptar y entrar a Household" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cerrar sesión y cambiar de cuenta" }));
    expect(router.replace).toHaveBeenCalledWith("/sign-in?next=%2Finvitations%2Ftok-1&invitation=tok-1");
  });

  it("shows any other problem under the buttons and lets the person try again", async () => {
    let calls = 0;
    const { api } = fakeApi({
      "POST /api/v1/invitations/{token}/accept": () =>
        ++calls === 1
          ? problemResponse(409, "AlreadyMember")
          : jsonResponse(householdSpace({ role: "MEMBER" })),
    });
    card({ viewer: { email: "juan@example.com" }, api });
    await userEvent.click(screen.getByRole("button", { name: "Aceptar y entrar a Household" }));
    expect(await screen.findByText("Esa persona ya es miembro de este espacio.")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Aceptar y entrar a Household" }));
    expect(router.replace).toHaveBeenCalledWith("/spaces/sp-household");
  });

  it("shows a network failure as a problem, not as a crash", async () => {
    const { api } = fakeApi({
      "POST /api/v1/invitations/{token}/accept": () => {
        throw new TypeError("fetch failed");
      },
    });
    card({ viewer: { email: "juan@example.com" }, api });
    await userEvent.click(screen.getByRole("button", { name: "Aceptar y entrar a Household" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aceptar y entrar a Household" })).toBeEnabled();
  });

  it.each([
    ["EXPIRED", "Esta invitación venció. Pídele a Ana un enlace nuevo.", "Las invitaciones duran 7 días."],
    [
      "REVOKED",
      "Esta invitación ya no es válida: la revocaron.",
      "Si todavía quieres unirte, pídele a Ana una invitación nueva.",
    ],
    [
      "ACCEPTED",
      "Esta invitación ya se usó.",
      "Si todavía quieres unirte, pídele a Ana una invitación nueva.",
    ],
  ] as const)("says why a %s invitation cannot be used", async (status, message, body) => {
    const { container } = card({ preview: { ...LINK, status } });
    expect(screen.getByRole("heading", { level: 1, name: "Household" })).toBeInTheDocument();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByText(body)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a Hearth" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Crear cuenta y unirme" })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("closed states look the same to a signed-in person", () => {
    card({ preview: { ...LINK, status: "REVOKED" }, viewer: { email: "juan@example.com" } });
    expect(screen.getByText("Esta invitación ya no es válida: la revocaron.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not make up a name when the inviter has left", () => {
    card({ preview: { ...LINK, status: "EXPIRED", invitedBy: null } });
    expect(
      screen.getByText("Esta invitación venció. Pídele a quien te invitó un enlace nuevo."),
    ).toBeInTheDocument();
  });

  it("says when there is no such invitation", async () => {
    const { container } = card({ preview: null });
    expect(screen.getByText("No encontramos esta invitación.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a Hearth" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("offers a visitor to claim Pedro's place, and a signed-in person to take it", async () => {
    const { unmount } = card({ kind: "claim", preview: CLAIM });
    expect(screen.getByText("Ana te envió tu lugar en")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Household, como Pedro" })).toBeInTheDocument();
    expect(screen.queryByText("Entras como")).not.toBeInTheDocument();
    expect(screen.getByText("Vence").nextSibling).toHaveTextContent("19/10/2026");
    expect(screen.getByRole("link", { name: "Crear cuenta y reclamar" })).toHaveAttribute(
      "href",
      "/sign-up?invitation=tok-1&next=%2Fclaims%2Ftok-1",
    );
    expect(screen.getByRole("link", { name: "Ya tengo cuenta: iniciar sesión" })).toHaveAttribute(
      "href",
      "/sign-in?next=%2Fclaims%2Ftok-1&invitation=tok-1",
    );
    unmount();
    const { api, requests } = fakeApi({
      "POST /api/v1/claims/{token}/accept": () => jsonResponse(householdSpace({ role: "MEMBER" })),
    });
    card({ kind: "claim", preview: CLAIM, viewer: { email: "pedro@example.com" }, api });
    await userEvent.click(screen.getByRole("button", { name: "Reclamar mi lugar en Household" }));
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/claims/tok-1/accept");
    expect(router.replace).toHaveBeenCalledWith("/spaces/sp-household");
  });

  it('leaves out "como <name>" when the preview has no guest name', () => {
    card({ kind: "claim", preview: { ...CLAIM, guestName: null } });
    expect(screen.getByRole("heading", { level: 1, name: "Household" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "En Household ya tienes un lugar de invitado. Al reclamarlo, lo que pagaste, tus partes y los pagos que recibiste pasan a tu cuenta, sin cambiar nada.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/como/)).not.toBeInTheDocument();
  });

  it.each([
    ["ACCEPTED", "Este lugar de invitado ya fue reclamado."],
    ["REVOKED", "Esta invitación ya no es válida: la revocaron."],
    ["EXPIRED", "Esta invitación venció. Pídele a Ana un enlace nuevo."],
  ] as const)("says why a %s claim link cannot be used", (status, message) => {
    card({ kind: "claim", preview: { ...CLAIM, status } });
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a Hearth" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("says when there is no such claim link", () => {
    card({ kind: "claim", preview: null });
    expect(screen.getByText("No encontramos esta invitación.")).toBeInTheDocument();
  });

  it("speaks English to an English visitor", () => {
    card({}, "en");
    expect(screen.getByText("Ana invites you to")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create an account and join" })).toBeInTheDocument();
    expect(screen.getByText("Expires").nextSibling).toHaveTextContent("19/10/2026");
  });
});
