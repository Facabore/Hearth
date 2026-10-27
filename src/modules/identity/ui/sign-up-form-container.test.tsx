import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { meDto } from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { SignUpFormContainer } from "./sign-up-form-container";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

describe("sign-up after the session starts (#196)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refreshes after landing: the root layout, shared with the visitor's screen, takes the person's own language", async () => {
    const { api } = fakeApi({ "POST /api/v1/auth/sign-up": () => jsonResponse({ user: meDto() }, 201) });
    renderWithIntl(<SignUpFormContainer api={api} />);
    await userEvent.type(screen.getByLabelText("Nombre"), "Ana");
    await userEvent.type(screen.getByLabelText("Correo electrónico"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Contraseña"), "123456789012");
    await userEvent.type(screen.getByLabelText("Confirmar contraseña"), "123456789012");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});
