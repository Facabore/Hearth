import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { guestDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import { AddGuestsSheet } from "./add-guests-sheet";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

const BATCH = "POST /api/v1/spaces/{spaceId}/guests/batch";
const pedro = guestDto();
const marta = guestDto({ id: "m-marta", displayName: "Marta" });

const open = (
  api: Api,
  extra: { onAdded?: (members: unknown[]) => void; onOpenChange?: () => void } = {},
) => {
  renderWithIntl(
    <AddGuestsSheet
      open
      onOpenChange={extra.onOpenChange ?? (() => undefined)}
      space={{ id: "sp-household", name: "Household" }}
      api={api}
      {...(extra.onAdded ? { onAdded: extra.onAdded } : {})}
    />,
  );
  return screen.getByRole("dialog", { name: "Agregar invitados a Household" });
};
const card = (sheet: HTMLElement, n: number) => within(sheet).getByRole("group", { name: `Invitado ${n}` });

describe("the add-guests sheet (P309, boards Agregar invitados · varios a la vez, … · nombre repetido)", () => {
  it("adds two guests in one request, all or nothing, and hands them back before closing", async () => {
    const { api, requests } = fakeApi({ [BATCH]: () => jsonResponse({ items: [pedro, marta] }, 201) });
    const onAdded = vi.fn();
    const onOpenChange = vi.fn();
    const sheet = open(api, { onAdded, onOpenChange });
    expect(within(sheet).getByRole("button", { name: "Agregar invitado" })).toBeInTheDocument();
    await userEvent.type(within(card(sheet, 1)).getByLabelText("Nombre"), " Pedro ");
    await userEvent.type(within(card(sheet, 1)).getByLabelText("Correo (opcional)"), "pedro@example.com");
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar otro invitado" }));
    await userEvent.type(within(card(sheet, 2)).getByLabelText("Nombre"), "Marta");
    await userEvent.dblClick(within(sheet).getByRole("button", { name: "Agregar 2 invitados" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-household/guests/batch");
    expect(await requests[0]!.json()).toEqual({
      guests: [{ displayName: "Pedro", contactEmail: "pedro@example.com" }, { displayName: "Marta" }],
    });
    expect(onAdded).toHaveBeenCalledWith([pedro, marta]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers Quitar only while there are two or more cards, and ignores an empty card", async () => {
    const { api, requests } = fakeApi({ [BATCH]: () => jsonResponse({ items: [marta] }, 201) });
    const sheet = open(api);
    expect(within(sheet).queryByRole("button", { name: "Quitar" })).not.toBeInTheDocument();
    await userEvent.type(within(card(sheet, 1)).getByLabelText("Nombre"), "Pedro");
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar otro invitado" }));
    await userEvent.type(within(card(sheet, 2)).getByLabelText("Nombre"), "Marta");
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar otro invitado" }));
    expect(within(sheet).getByRole("button", { name: "Agregar 2 invitados" })).toBeInTheDocument();
    expect(within(sheet).getByRole("note")).toHaveTextContent(
      "Si alguno se registra después, le envías un enlace para reclamar su lugar y se lleva todo su historial.",
    );
    await userEvent.click(within(card(sheet, 1)).getByRole("button", { name: "Quitar" }));
    expect(within(card(sheet, 1)).getByLabelText("Nombre")).toHaveValue("Marta");
    expect(within(sheet).getAllByRole("group")).toHaveLength(2);
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar invitado" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(await requests[0]!.json()).toEqual({ guests: [{ displayName: "Marta" }] });
  });

  it("shows a refused name on its own card and says nobody was added", async () => {
    const { api } = fakeApi({ [BATCH]: () => problemResponse(409, "MemberNameTaken", { guest: 1 }) });
    const onAdded = vi.fn();
    const sheet = open(api, { onAdded });
    await userEvent.type(within(card(sheet, 1)).getByLabelText("Nombre"), "Pedro");
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar otro invitado" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar otro invitado" }));
    await userEvent.type(within(card(sheet, 3)).getByLabelText("Nombre"), "Juan");
    // The empty second card is not sent, so the API's index 1 is the third card.
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar 2 invitados" }));
    await waitFor(() =>
      expect(within(card(sheet, 3)).getByLabelText("Nombre")).toHaveAccessibleDescription(
        "Se verá como «Juan (invitado)». No puede repetir el nombre de otro miembro. Ya hay un miembro con ese nombre en este espacio.",
      ),
    );
    expect(within(card(sheet, 1)).getByLabelText("Nombre")).not.toHaveAttribute("aria-invalid");
    expect(
      within(sheet).getByText(
        "No agregamos a nadie todavía: corrige el nombre marcado y vuelve a intentarlo.",
      ),
    ).toBeInTheDocument();
    expect(onAdded).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("puts an email the API refuses on its card", async () => {
    const { api } = fakeApi({
      [BATCH]: () =>
        problemResponse(422, "ValidationFailed", {
          errors: [{ path: "guests.0.contactEmail", message: "Invalid email" }],
        }),
    });
    const sheet = open(api);
    await userEvent.type(within(card(sheet, 1)).getByLabelText("Nombre"), "Pedro");
    await userEvent.type(within(card(sheet, 1)).getByLabelText("Correo (opcional)"), "pedro@x");
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar invitado" }));
    await waitFor(() =>
      expect(within(card(sheet, 1)).getByLabelText("Correo (opcional)")).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
  });

  it("pluralizes the button in English and has no axe violations", async () => {
    renderWithIntl(
      <AddGuestsSheet
        open
        onOpenChange={() => undefined}
        space={{ id: "sp", name: "Home" }}
        api={fakeApi({}).api}
      />,
      { locale: "en" },
    );
    const sheet = screen.getByRole("dialog", { name: "Add guests to Home" });
    expect(within(sheet).getByRole("button", { name: "Add guest" })).toBeInTheDocument();
    await userEvent.type(within(sheet).getByLabelText("Name"), "Pedro");
    await userEvent.click(within(sheet).getByRole("button", { name: "Add another guest" }));
    await userEvent.type(within(sheet).getAllByLabelText("Name")[1]!, "Marta");
    expect(within(sheet).getByRole("button", { name: "Add 2 guests" })).toBeInTheDocument();
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
