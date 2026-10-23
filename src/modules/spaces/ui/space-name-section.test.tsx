import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { householdSpace, spaceDto } from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { SpaceNameSection } from "./space-name-section";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

const renamed = (name: string) => () => jsonResponse(spaceDto({ name }));

describe("space name in Settings (#167)", () => {
  it("renames the personal space when the field is left, says Guardado and refreshes the shell", async () => {
    const { api, requests } = fakeApi({ "PATCH /api/v1/spaces/{spaceId}": renamed("Mis finanzas") });
    const { container } = renderWithIntl(<SpaceNameSection space={spaceDto()} api={api} />);
    expect(screen.getByRole("heading", { level: 2, name: "Espacio" })).toBeInTheDocument();
    const field = screen.getByLabelText("Nombre del espacio");
    expect(field).toHaveValue("Personal");
    await userEvent.clear(field);
    await userEvent.type(field, "  Mis finanzas ");
    await userEvent.tab();
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-personal");
    expect(requests[0]!.method).toBe("PATCH");
    expect(await requests[0]!.json()).toEqual({ name: "Mis finanzas" });
    expect(await screen.findByRole("status")).toHaveTextContent("Guardado");
    expect(field).toHaveValue("Mis finanzas");
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("stores the name on Enter too, and sends nothing when the name did not change", async () => {
    const { api, requests } = fakeApi({ "PATCH /api/v1/spaces/{spaceId}": renamed("Casa") });
    renderWithIntl(<SpaceNameSection space={householdSpace({ role: "ADMIN" })} api={api} />);
    const field = screen.getByLabelText("Nombre del espacio");
    await userEvent.click(field);
    await userEvent.tab();
    expect(requests).toHaveLength(0);
    await userEvent.clear(field);
    await userEvent.type(field, "Casa{Enter}");
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-household");
    expect(await screen.findByRole("status")).toHaveTextContent("Guardado");
    await userEvent.tab();
    expect(requests).toHaveLength(1);
  });

  it("stops saying Guardado after about two seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { api } = fakeApi({ "PATCH /api/v1/spaces/{spaceId}": renamed("Casa") });
    renderWithIntl(<SpaceNameSection space={spaceDto()} api={api} />);
    const field = screen.getByLabelText("Nombre del espacio");
    await userEvent.clear(field);
    await userEvent.type(field, "Casa{Enter}");
    expect(await screen.findByRole("status")).toHaveTextContent("Guardado");
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("puts the API's refusal under the field, keeps what was typed and refreshes nothing", async () => {
    const { api } = fakeApi({
      "PATCH /api/v1/spaces/{spaceId}": () => problemResponse(422, "InvalidSpaceName"),
    });
    renderWithIntl(<SpaceNameSection space={spaceDto()} api={api} />);
    const field = screen.getByLabelText("Nombre del espacio");
    await userEvent.clear(field);
    await userEvent.tab();
    await waitFor(() =>
      expect(field).toHaveAccessibleDescription(
        "Así aparece en el selector de espacios y en sus pantallas. El nombre del espacio debe tener entre 1 y 80 caracteres.",
      ),
    );
    expect(field).toHaveValue("");
    expect(screen.queryByRole("status")).toBeNull();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it.each(["MEMBER", "VIEWER"] as const)("shows a %s no way to rename the space", (role) => {
    renderWithIntl(<SpaceNameSection space={householdSpace({ role })} api={fakeApi({}).api} />);
    expect(screen.queryByLabelText("Nombre del espacio")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Espacio" })).toBeNull();
  });
});
