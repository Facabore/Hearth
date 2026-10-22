import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserTimeZone } from "@/shared/ui/format/zones";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { meDto } from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { SignUpClosedNotice } from "./sign-up-closed-notice";
import { SignUpFormContainer } from "./sign-up-form-container";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const fill = async ({ password = "123456789012", confirm }: { password?: string; confirm?: string } = {}) => {
  await userEvent.type(screen.getByLabelText("Nombre"), "Ana");
  await userEvent.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
  await userEvent.type(screen.getByLabelText("Contraseña"), password);
  await userEvent.type(screen.getByLabelText("Confirmar contraseña"), confirm ?? password);
};

describe("sign-up screen (HU-E9-01)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the account with the browser's time zone and lands on the personal space", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/auth/sign-up": () => jsonResponse({ user: meDto() }, 201),
    });
    const { container } = renderWithIntl(<SignUpFormContainer api={api} />);
    expect(await axeViolations(container)).toEqual([]);
    expect(screen.getByLabelText("Contraseña")).toHaveAccessibleDescription("Al menos 8 caracteres");
    await fill();
    await userEvent.click(screen.getAllByRole("button", { name: "Mostrar contraseña" })[0]!);
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "text");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await requests[0]!.json()).toEqual({
      name: "Ana",
      email: "ana@example.com",
      password: "123456789012",
      timezone: browserTimeZone(),
      locale: "es",
    });
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("returns to the invitation after signing up, and keeps it in the link to sign in (ruling P157)", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/auth/sign-up": () => jsonResponse({ user: meDto() }, 201),
    });
    renderWithIntl(<SignUpFormContainer next="/invitations/tok-1" invitation="tok-1" api={api} />);
    expect(screen.getByRole("link", { name: "Inicia sesión" })).toHaveAttribute(
      "href",
      "/sign-in?next=%2Finvitations%2Ftok-1&invitation=tok-1",
    );
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await requests[0]!.json()).toMatchObject({ invitationToken: "tok-1" });
    expect(router.replace).toHaveBeenCalledWith("/invitations/tok-1");
  });

  it("links to a plain sign-in when there is neither a next nor an invitation, and keeps only what is there", () => {
    const { unmount } = renderWithIntl(<SignUpFormContainer />);
    expect(screen.getByRole("link", { name: "Inicia sesión" })).toHaveAttribute("href", "/sign-in");
    unmount();
    const withInvitation = renderWithIntl(<SignUpFormContainer invitation="tok 1" />);
    expect(screen.getByRole("link", { name: "Inicia sesión" })).toHaveAttribute(
      "href",
      "/sign-in?invitation=tok%201",
    );
    withInvitation.unmount();
    renderWithIntl(<SignUpFormContainer next="/settings?tab=region" />);
    expect(screen.getByRole("link", { name: "Inicia sesión" })).toHaveAttribute(
      "href",
      "/sign-in?next=%2Fsettings%3Ftab%3Dregion",
    );
  });

  it("shows errors.EmailTaken next to the email field and stays on the screen", async () => {
    const { api } = fakeApi({ "POST /api/v1/auth/sign-up": () => problemResponse(409, "EmailTaken") });
    renderWithIntl(<SignUpFormContainer api={api} />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    const email = screen.getByLabelText("Correo electrónico");
    await waitFor(() => expect(email).toHaveAttribute("aria-invalid", "true"));
    expect(email).toHaveAccessibleDescription("Ya existe una cuenta con este correo. Inicia sesión");
    // The footer has its own "Inicia sesión" link: look inside the email field's error.
    const emailError = document.getElementById(email.getAttribute("aria-describedby")!)!;
    expect(within(emailError).getByRole("link", { name: "Inicia sesión" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("keeps next and the invitation in the sign-in link of the email-taken error (N5)", async () => {
    const { api } = fakeApi({ "POST /api/v1/auth/sign-up": () => problemResponse(409, "EmailTaken") });
    renderWithIntl(<SignUpFormContainer next="/invitations/tok-1" invitation="tok-1" api={api} />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    const email = screen.getByLabelText("Correo electrónico");
    await waitFor(() => expect(email).toHaveAttribute("aria-invalid", "true"));
    const emailError = document.getElementById(email.getAttribute("aria-describedby")!)!;
    expect(within(emailError).getByRole("link", { name: "Inicia sesión" })).toHaveAttribute(
      "href",
      "/sign-in?next=%2Finvitations%2Ftok-1&invitation=tok-1",
    );
  });

  it("shows a too-short password next to the password field", async () => {
    const { api } = fakeApi({ "POST /api/v1/auth/sign-up": () => problemResponse(422, "PasswordTooShort") });
    renderWithIntl(<SignUpFormContainer api={api} />);
    await fill({ password: "1234567" });
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Contraseña")).toHaveAccessibleDescription(
        "Al menos 8 caracteres La contraseña debe tener al menos 8 caracteres.",
      ),
    );
  });

  it("sends nothing when the confirmation differs, says so under it and focuses it (ruling P147)", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/auth/sign-up": () => jsonResponse({ user: meDto() }, 201),
    });
    const { container } = renderWithIntl(<SignUpFormContainer api={api} />);
    await fill({ confirm: "123456789013" });
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    const confirm = screen.getByLabelText("Confirmar contraseña");
    await waitFor(() => expect(confirm).toHaveFocus());
    expect(confirm).toHaveAttribute("aria-invalid", "true");
    expect(confirm).toHaveAccessibleDescription("Las contraseñas no coinciden.");
    expect(confirm).toHaveAttribute("autocomplete", "new-password");
    expect(await axeViolations(container)).toEqual([]);
    expect(requests).toHaveLength(0);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("lets the person fix the confirmation and then signs up, without the mismatch message (ruling P147)", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/auth/sign-up": () => jsonResponse({ user: meDto() }, 201),
    });
    renderWithIntl(<SignUpFormContainer api={api} />);
    await fill({ confirm: "nope" });
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    const confirm = screen.getByLabelText("Confirmar contraseña");
    await waitFor(() => expect(confirm).toHaveAttribute("aria-invalid", "true"));
    await userEvent.clear(confirm);
    // The message goes as soon as the person edits, not only when they submit again.
    expect(confirm).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText("Las contraseñas no coinciden.")).not.toBeInTheDocument();
    await userEvent.type(confirm, "123456789012");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(screen.queryByText("Las contraseñas no coinciden.")).not.toBeInTheDocument();
    expect(await requests[0]!.json()).not.toHaveProperty("confirmPassword");
  });

  it("sends the screen's current locale so a visitor who chose English stays in English (rulings P142, P147)", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/auth/sign-up": () => jsonResponse({ user: meDto() }, 201),
    });
    renderWithIntl(<SignUpFormContainer api={api} />, { locale: "en" });
    await userEvent.type(screen.getByLabelText("Name"), "Ana");
    await userEvent.type(screen.getByLabelText("Email"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "123456789012");
    await userEvent.type(screen.getByLabelText("Confirm password"), "123456789012");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await requests[0]!.json()).toMatchObject({ locale: "en" });
  });

  it("sends the invitation token of the URL, and only then (rulings P143, P147)", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/auth/sign-up": () => jsonResponse({ user: meDto() }, 201),
    });
    renderWithIntl(<SignUpFormContainer api={api} invitation="tok-123" />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await requests[0]!.json()).toMatchObject({ invitationToken: "tok-123", locale: "es" });
  });

  it("shows the closed notice instead of the form when the API answers SignUpClosed (ruling P147)", async () => {
    const { api } = fakeApi({ "POST /api/v1/auth/sign-up": () => problemResponse(403, "SignUpClosed") });
    renderWithIntl(<SignUpFormContainer api={api} invitation="stale" />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByRole("heading", { name: "El registro está cerrado" })).toBeInTheDocument();
    expect(screen.getByText("Pídele una invitación a alguien de tu hogar.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inicia sesión" })).toHaveAttribute(
      "href",
      "/sign-in?invitation=stale",
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("keeps where the visitor was going and the invitation in the closed notice's sign-in link (N5)", async () => {
    const { api } = fakeApi({ "POST /api/v1/auth/sign-up": () => problemResponse(403, "SignUpClosed") });
    renderWithIntl(<SignUpFormContainer next="/invitations/stale" invitation="stale" api={api} />);
    await fill();
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await screen.findByRole("heading", { name: "El registro está cerrado" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inicia sesión" })).toHaveAttribute(
      "href",
      "/sign-in?next=%2Finvitations%2Fstale&invitation=stale",
    );
  });

  it("gives the sign-in link a 44 px target (S3)", () => {
    renderWithIntl(<SignUpFormContainer />);
    expect(screen.getByRole("link", { name: "Inicia sesión" })).toHaveClass("min-h-11", "min-w-11");
  });

  it("links to sign in under the form (ruling P147)", () => {
    renderWithIntl(<SignUpFormContainer />);
    expect(screen.getByText(/¿Ya tienes cuenta\?/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inicia sesión" })).toHaveAttribute("href", "/sign-in");
  });
});

describe("sign-up closed notice (ruling P147)", () => {
  it("says so in both languages, with a way to sign in, and passes axe", async () => {
    const { container, unmount } = renderWithIntl(<SignUpClosedNotice />);
    expect(await axeViolations(container)).toEqual([]);
    expect(screen.getByRole("heading", { level: 1, name: "El registro está cerrado" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inicia sesión" })).toHaveAttribute("href", "/sign-in");
    unmount();
    renderWithIntl(<SignUpClosedNotice />, { locale: "en" });
    expect(screen.getByRole("heading", { name: "Sign-up is closed" })).toBeInTheDocument();
    expect(screen.getByText("Ask someone in your household for an invitation.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
  });

  it("links to the sign-in href it is given (N5)", () => {
    renderWithIntl(<SignUpClosedNotice signInHref="/sign-in?next=%2Fsettings" />);
    expect(screen.getByRole("link", { name: "Inicia sesión" })).toHaveAttribute(
      "href",
      "/sign-in?next=%2Fsettings",
    );
  });
});
