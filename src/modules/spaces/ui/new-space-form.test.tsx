import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { householdSpace } from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { NewSpaceForm } from "./new-space-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

describe("new shared space (HU-E9-05, ruling P161)", () => {
  it("creates Household in COP and opens its members screen", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces": () => jsonResponse(householdSpace(), 201) });
    const { container } = renderWithIntl(<NewSpaceForm backHref="/spaces/sp-personal" api={api} />);
    expect(screen.getByRole("radio", { name: "COP · Peso colombiano" })).toBeChecked();
    await userEvent.type(screen.getByLabelText("Nombre"), " Household ");
    await userEvent.click(screen.getByRole("button", { name: "Crear espacio" }));
    expect(await requests[0]!.json()).toEqual({ kind: "SHARED", name: "Household", currency: "COP" });
    expect(router.replace).toHaveBeenCalledWith("/spaces/sp-household/members");
    expect(router.refresh).toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("puts InvalidSpaceName under the name and creates nothing else", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces": () => problemResponse(422, "InvalidSpaceName"),
    });
    renderWithIntl(<NewSpaceForm backHref="/spaces/sp-personal" api={api} />);
    await userEvent.click(screen.getByRole("radio", { name: "USD · Dólar estadounidense" }));
    await userEvent.click(screen.getByRole("button", { name: "Crear espacio" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Nombre")).toHaveAccessibleDescription(
        "El nombre del espacio debe tener entre 1 y 80 caracteres.",
      ),
    );
    expect(screen.getByRole("radiogroup", { name: "Moneda" })).toHaveAccessibleDescription(
      "Una sola moneda por espacio. Deja de poder cambiarse cuando el espacio tiene movimientos.",
    );
    expect(await requests[0]!.json()).toMatchObject({ currency: "USD" });
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("new shared space: the way back (S1)", () => {
  it("has a Volver link to the given space home, next to the title", () => {
    renderWithIntl(<NewSpaceForm backHref="/spaces/sp-household" api={fakeApi({}).api} />);
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/spaces/sp-household");
    expect(
      screen.getByRole("heading", { level: 1, name: "Crear un espacio compartido" }),
    ).toBeInTheDocument();
  });
});
