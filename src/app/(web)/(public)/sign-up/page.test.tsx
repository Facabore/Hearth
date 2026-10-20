import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { IntlWrapper } from "../../../../../tests/support/ui/render";

const mocks = vi.hoisted(() => ({ mode: vi.fn() }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/shared/ui/api/server", () => ({ getSignUpMode: mocks.mode }));

const { default: SignUpPage } = await import("./page");

const open = async (search: { invitation?: string | string[] }) =>
  render(await SignUpPage({ searchParams: Promise.resolve(search) }), { wrapper: IntlWrapper("es") });

describe("sign-up page (HU-E9-01, ruling P147)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the form while sign-up is open", async () => {
    mocks.mode.mockResolvedValue("open");
    await open({});
    expect(screen.getByLabelText("Confirmar contraseña")).toBeInTheDocument();
  });

  it("shows the notice and no form when sign-up is closed and the URL has no invitation", async () => {
    mocks.mode.mockResolvedValue("closed");
    for (const search of [{}, { invitation: "" }, { invitation: ["a", "b"] }]) {
      const { unmount } = await open(search);
      expect(screen.getByRole("heading", { name: "El registro está cerrado" })).toBeInTheDocument();
      expect(screen.queryByLabelText("Nombre")).not.toBeInTheDocument();
      unmount();
    }
  });

  it("shows the form when sign-up is closed but the URL carries an invitation", async () => {
    mocks.mode.mockResolvedValue("closed");
    await open({ invitation: "tok-123" });
    expect(screen.getByLabelText("Nombre")).toBeInTheDocument();
    expect(screen.queryByText("El registro está cerrado")).not.toBeInTheDocument();
  });

  it("hands the token to the form, which sends it", async () => {
    mocks.mode.mockResolvedValue("closed");
    const fetch = vi.fn<(request: Request) => Promise<Response>>(async () => jsonResponse({}, 201));
    vi.stubGlobal("fetch", fetch);
    await open({ invitation: "tok-123" });
    await userEvent.type(screen.getByLabelText("Nombre"), "Ana");
    await userEvent.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Contraseña"), "123456789012");
    await userEvent.type(screen.getByLabelText("Confirmar contraseña"), "123456789012");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await fetch.mock.calls[0]![0].json()).toMatchObject({ invitationToken: "tok-123" });
    vi.unstubAllGlobals();
  });
});
