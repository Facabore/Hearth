import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { meDto } from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { LanguageToggle } from "./language-toggle";
import { SignInFormContainer } from "./sign-in-form-container";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const signIn = async () => {
  await userEvent.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
  await userEvent.type(screen.getByLabelText("Contraseña"), "123456789012");
  await userEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
};

describe("sign-in screen (HU-E9-01)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("signs in and returns to the protected page the visitor opened", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/auth/sign-in": () => jsonResponse({ user: meDto(), token: "t" }),
    });
    const { container } = renderWithIntl(
      <SignInFormContainer next="/spaces/sp-personal/transactions" api={api} />,
    );
    expect(await axeViolations(container)).toEqual([]);
    await signIn();
    expect(await requests[0]!.json()).toEqual({ email: "ana@example.com", password: "123456789012" });
    expect(router.replace).toHaveBeenCalledWith("/spaces/sp-personal/transactions");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("shows InvalidCredentials as a form message and stays on the screen", async () => {
    const { api } = fakeApi({
      "POST /api/v1/auth/sign-in": () => problemResponse(401, "InvalidCredentials"),
    });
    renderWithIntl(<SignInFormContainer next="/" api={api} />);
    await signIn();
    expect(await screen.findByRole("alert")).toHaveTextContent("El correo o la contraseña no coinciden.");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("switches the language with a cookie and reloads the texts", async () => {
    renderWithIntl(<LanguageToggle locale="es" />);
    await userEvent.click(screen.getByRole("button", { name: "Cambiar idioma, actual español" }));
    expect(document.cookie).toContain("hearth.locale=en");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("switches only the visitor's cookie: the stored locale is never written (ruling P152)", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    renderWithIntl(<LanguageToggle locale="en" />, { locale: "en" });
    await userEvent.click(screen.getByRole("button", { name: "Change language, current English" }));
    expect(document.cookie).toContain("hearth.locale=es");
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("explains a forgotten password inline, with the button describing what it opens (ruling P146)", async () => {
    renderWithIntl(<SignInFormContainer next="/" />);
    const forgot = screen.getByRole("button", { name: "¿Olvidaste tu contraseña?" });
    const help = "Pedile a quien administra Hearth que la restablezca.";
    expect(forgot).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(help)).not.toBeVisible();
    await userEvent.click(forgot);
    expect(forgot).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(help)).toBeVisible();
    expect(forgot).toHaveAttribute("aria-controls", screen.getByText(help).id);
    await userEvent.click(forgot);
    expect(forgot).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(help)).not.toBeVisible();
  });

  it("offers to create an account only while sign-up is open (rulings P143 and P146)", () => {
    const { unmount } = renderWithIntl(<SignInFormContainer next="/" signUp="open" />);
    expect(screen.getByRole("link", { name: "Crear una cuenta" })).toHaveAttribute("href", "/sign-up");
    unmount();
    renderWithIntl(<SignInFormContainer next="/" signUp="closed" />);
    expect(screen.queryByRole("link", { name: "Crear una cuenta" })).not.toBeInTheDocument();
  });

  it("after a problem keeps the email, clears the password and puts the focus back in it (ruling P146)", async () => {
    const { api } = fakeApi({
      "POST /api/v1/auth/sign-in": () => problemResponse(401, "InvalidCredentials"),
    });
    renderWithIntl(<SignInFormContainer next="/" api={api} />);
    await signIn();
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Correo electrónico")).toHaveValue("ana@example.com");
    expect(screen.getByLabelText("Contraseña")).toHaveValue("");
    expect(screen.getByLabelText("Contraseña")).toHaveFocus();
  });

  it("tells a visitor whose session expired, and only then (ruling P151)", () => {
    const { unmount } = renderWithIntl(<SignInFormContainer next="/settings" expired />);
    expect(screen.getByRole("status")).toHaveTextContent("Tu sesión venció. Volvé a entrar.");
    unmount();
    renderWithIntl(<SignInFormContainer next="/settings" />);
    expect(screen.queryByText("Tu sesión venció. Volvé a entrar.")).not.toBeInTheDocument();
  });

  it("speaks English with the same keys", () => {
    renderWithIntl(<SignInFormContainer next="/" expired />, { locale: "en" });
    expect(screen.getByText("Your session expired. Sign in again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Forgot your password?" })).toBeInTheDocument();
  });
});
