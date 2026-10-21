import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { accountDto, spaceDto } from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { NewAccountForm } from "./new-account-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

describe("new account form (HU-E9-03)", () => {
  it("shows only the chosen type's attributes and creates the account", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/accounts": () => jsonResponse(accountDto({ name: "Visa" }), 201),
    });
    const { container } = renderWithIntl(
      <NewAccountForm space={spaceDto()} formats={BUILT_IN_FORMATS} api={api} />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Efectivo" }));
    expect(screen.queryByLabelText("Últimos 4")).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Tarjeta de crédito" }));
    for (const label of [
      "Nombre",
      "Debes hoy",
      "Cupo",
      "Día de corte",
      "Día de pago",
      "Últimos 4",
      "Interés M.V.",
    ])
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.queryByLabelText("Tasa E.A.")).toBeNull();
    expect(screen.getByRole("switch", { name: "Contar en el disponible" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await userEvent.type(screen.getByLabelText("Nombre"), "Visa");
    await userEvent.type(screen.getByLabelText("Debes hoy"), "350.000");
    await userEvent.type(screen.getByLabelText("Cupo"), "5.000.000");
    await userEvent.type(screen.getByLabelText("Día de pago"), "15");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await requests[0]!.json()).toEqual({
      name: "Visa",
      type: "CREDIT_CARD",
      openingBalance: { amount: "-35000000", currency: "COP" },
      terms: { creditLimit: { amount: "500000000", currency: "COP" }, paymentDay: 15 },
    });
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-personal/accounts");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows a taken name next to the name field", async () => {
    const { api } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/accounts": () => problemResponse(409, "AccountNameTaken"),
    });
    renderWithIntl(<NewAccountForm space={spaceDto()} formats={BUILT_IN_FORMATS} api={api} />);
    await userEvent.click(screen.getByRole("radio", { name: "Banco" }));
    await userEvent.type(screen.getByLabelText("Nombre"), "Bancolombia");
    await userEvent.type(screen.getByLabelText("Saldo inicial"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveAttribute("aria-invalid", "true"));
  });

  it("sends a switch only once the person touched it", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/accounts": () => jsonResponse(accountDto({ name: "Caja" }), 201),
    });
    renderWithIntl(<NewAccountForm space={spaceDto()} formats={BUILT_IN_FORMATS} api={api} />);
    await userEvent.click(screen.getByRole("radio", { name: "Efectivo" }));
    await userEvent.type(screen.getByLabelText("Nombre"), "Caja");
    await userEvent.type(screen.getByLabelText("Saldo inicial"), "1.500,5");
    await userEvent.click(screen.getByRole("switch", { name: "Contar en el patrimonio" }));
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(await requests[0]!.json()).toEqual({
      name: "Caja",
      type: "CASH",
      openingBalance: { amount: "150050", currency: "COP" },
      includeInNetWorth: false,
    });
  });

  it("asks for a readable amount without calling the API", async () => {
    const { api, requests } = fakeApi({});
    renderWithIntl(<NewAccountForm space={spaceDto()} formats={BUILT_IN_FORMATS} api={api} />);
    await userEvent.click(screen.getByRole("radio", { name: "Banco" }));
    await userEvent.type(screen.getByLabelText("Nombre"), "Bancolombia");
    await userEvent.type(screen.getByLabelText("Saldo inicial"), "dos mil");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(screen.getByLabelText("Saldo inicial")).toHaveAccessibleDescription(
      "Escribe un monto como 1.500.000.",
    );
    expect(requests).toHaveLength(0);
  });

  it("offers a shared fund only in a shared space", () => {
    const { unmount } = renderWithIntl(<NewAccountForm space={spaceDto()} formats={BUILT_IN_FORMATS} />);
    expect(screen.queryByRole("radio", { name: "Fondo compartido" })).toBeNull();
    unmount();
    renderWithIntl(<NewAccountForm space={spaceDto({ kind: "SHARED" })} formats={BUILT_IN_FORMATS} />);
    expect(screen.getByRole("radio", { name: "Fondo compartido" })).toBeInTheDocument();
  });
});

describe("new account form: the way back (S1)", () => {
  it("has a Volver link to the accounts of the space, before the title", () => {
    renderWithIntl(<NewAccountForm space={spaceDto()} formats={BUILT_IN_FORMATS} api={fakeApi({}).api} />);
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts",
    );
    expect(screen.getByRole("heading", { level: 1, name: "Nueva cuenta" })).toBeInTheDocument();
  });
});
