import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { fakeApi, jsonResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { GroupSheet } from "./group-sheet";

const GROUPS = "POST /api/v1/spaces/{spaceId}/category-groups";

/** Opens the sheet over an API that answers a create with the group it was sent; returns the bodies it was sent. */
const openSheet = () => {
  const { api, requests } = fakeApi({
    [GROUPS]: async (request) =>
      jsonResponse({ id: "g-new", key: null, archivedAt: null, ...(await request.clone().json()) }, 201),
  });
  const onCreated = vi.fn();
  renderWithIntl(<GroupSheet spaceId="s-1" api={api} onClose={vi.fn()} onCreated={onCreated} />);
  const sheet = screen.getByRole("dialog", { name: "Nuevo grupo" });
  const create = async (name: string) => {
    await userEvent.type(within(sheet).getByLabelText("Nombre"), name);
    await userEvent.click(within(sheet).getByRole("button", { name: "Crear grupo" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    return (await requests.at(-1)!.clone().json()) as Record<string, unknown>;
  };
  return { sheet, create };
};

describe("group sheet: only a chosen style is sent (HU-E3-05, #194)", () => {
  it("preselects the tag icon and Graphite, the API's own default", () => {
    const { sheet } = openSheet();
    expect(within(sheet).getByRole("radio", { name: "Etiqueta" })).toHaveAttribute("aria-checked", "true");
    expect(within(sheet).getByRole("radio", { name: "Grafito" })).toHaveAttribute("aria-checked", "true");
  });

  it("sends a chosen color without an icon nobody chose", async () => {
    const { sheet, create } = openSheet();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Oliva" }));
    expect(await create("Pets")).toEqual({ name: "Pets", color: "OLIVE" });
  });

  it("sends a chosen icon without a color nobody chose", async () => {
    const { sheet, create } = openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: "Ver todos" }));
    const library = await screen.findByRole("dialog", { name: "Biblioteca de íconos" });
    await userEvent.click(within(library).getByRole("button", { name: "Mascotas" }));
    expect(await create("Pets")).toEqual({ name: "Pets", icon: { kind: "SYMBOL", name: "paw" } });
  });

  it("says in English, between curly quotes, that a search matches no icon (#194)", async () => {
    const { api } = fakeApi({});
    renderWithIntl(<GroupSheet spaceId="s-1" api={api} onClose={vi.fn()} onCreated={vi.fn()} />, {
      locale: "en",
    });
    const sheet = screen.getByRole("dialog", { name: "New group" });
    await userEvent.click(within(sheet).getByRole("button", { name: "See all" }));
    const library = await screen.findByRole("dialog", { name: "Icon library" });
    await userEvent.type(within(library).getByLabelText("Search icon"), "zzz");
    expect(within(library).getByRole("status")).toHaveTextContent("There is no icon “zzz”.");
  });

  it("sends no style when the person goes back to the default", async () => {
    const { sheet, create } = openSheet();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Oliva" }));
    await userEvent.click(within(sheet).getByRole("radio", { name: "Grafito" }));
    expect(await create("Pets")).toEqual({ name: "Pets" });
  });
});
