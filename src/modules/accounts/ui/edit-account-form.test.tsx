import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { accountDto, cop, spaceDto } from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { loadAccount } from "./edit-account-container";
import { EditAccountForm } from "./edit-account-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, notFound: vi.fn() }));
vi.mock("next/headers", () => ({}));
beforeEach(() => vi.clearAllMocks());

/** A card that chose its own icon and left both switches at the type's defaults. */
const visa = accountDto({
  id: "a-visa",
  name: "Visa",
  type: "CREDIT_CARD",
  openingBalance: cop(-350_000),
  lastFour: "4821",
  icon: "star",
  includeInAvailable: false,
  stored: { icon: "star", includeInAvailable: null, includeInNetWorth: null },
  defaults: { icon: "card", includeInAvailable: false, includeInNetWorth: true },
  terms: { ...accountDto().terms, creditLimit: cop(5_000_000), monthlyRate: "1.8900" },
});
const PATCH = "PATCH /api/v1/spaces/{spaceId}/accounts/{accountId}";
const render = (api: ReturnType<typeof fakeApi>["api"]) =>
  renderWithIntl(<EditAccountForm space={spaceDto()} account={visa} formats={BUILT_IN_FORMATS} api={api} />);

describe("edit account form (issue 169)", () => {
  it("starts from the account as stored, in the person's number format, with a way back", async () => {
    const { api } = fakeApi({});
    const { container } = render(api);
    expect(screen.getByRole("link", { name: /Volver/ })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts",
    );
    expect(screen.getByText("Tipo: Tarjeta de crédito")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Visa");
    expect(screen.getByLabelText("Debes hoy")).toHaveValue("350.000");
    expect(screen.getByLabelText("Cupo")).toHaveValue("5.000.000");
    expect(screen.getByLabelText("Últimos 4")).toHaveValue("4821");
    expect(screen.getByLabelText("Interés M.V.")).toHaveValue("1,89");
    expect(screen.getByRole("radio", { name: "Estrella" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Contar en el disponible" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("says which style is the type's default and which was chosen (#120)", () => {
    const { api } = fakeApi({});
    render(api);
    expect(screen.getAllByText("Predeterminado")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Restablecer Ícono" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Restablecer Contar/ })).toBeNull();
  });

  it("sends only what changed: a new name, a cleared Last 4, the icon back to its default and a switch", async () => {
    const { api, requests } = fakeApi({ [PATCH]: () => jsonResponse(visa) });
    render(api);
    await userEvent.clear(screen.getByLabelText("Nombre"));
    await userEvent.type(screen.getByLabelText("Nombre"), "Visa Oro");
    await userEvent.clear(screen.getByLabelText("Últimos 4"));
    await userEvent.click(screen.getByRole("button", { name: "Restablecer Ícono" }));
    expect(screen.getByRole("radio", { name: "Tarjeta" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("switch", { name: "Contar en el disponible" }));
    expect(screen.getByRole("button", { name: "Restablecer Contar en el disponible" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-personal/accounts/a-visa");
    expect(await requests[0]!.json()).toEqual({
      name: "Visa Oro",
      lastFour: null,
      icon: null,
      includeInAvailable: true,
    });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/spaces/sp-personal/accounts"));
    expect(router.refresh).toHaveBeenCalled();
  });

  it("changes the icon and sends what is owed negative", async () => {
    const { api, requests } = fakeApi({ [PATCH]: () => jsonResponse(visa) });
    render(api);
    await userEvent.click(screen.getByRole("radio", { name: "Avión" }));
    await userEvent.clear(screen.getByLabelText("Debes hoy"));
    await userEvent.type(screen.getByLabelText("Debes hoy"), "400.000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await requests[0]!.json()).toEqual({
      openingBalance: { amount: "-40000000", currency: "COP" },
      icon: "plane",
    });
  });

  it("goes back without a call when nothing changed", async () => {
    const { api, requests } = fakeApi({});
    render(api);
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(requests).toHaveLength(0);
    expect(router.replace).toHaveBeenCalledWith("/spaces/sp-personal/accounts");
  });

  it("says a rate it cannot read is a number, with a rate as the example, and sends nothing", async () => {
    const { api, requests } = fakeApi({ [PATCH]: () => jsonResponse(visa) });
    render(api);
    await userEvent.clear(screen.getByLabelText("Interés M.V."));
    await userEvent.type(screen.getByLabelText("Interés M.V."), "1,");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(screen.getByLabelText("Interés M.V.")).toHaveAccessibleDescription(
      /Escribe un número como 1,89\./,
    );
    expect(requests).toHaveLength(0);
  });

  it("shows a taken name next to the name field and stays", async () => {
    const { api } = fakeApi({ [PATCH]: () => problemResponse(409, "AccountNameTaken") });
    render(api);
    await userEvent.type(screen.getByLabelText("Nombre"), " 2");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveAttribute("aria-invalid", "true"));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("loads the one account, with its stored and default style, from the API", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/accounts/{accountId}": () => jsonResponse(visa),
    });
    expect(await loadAccount(api, "sp-personal", "a-visa")).toEqual({ ok: true, data: visa });
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-personal/accounts/a-visa");
  });
});
