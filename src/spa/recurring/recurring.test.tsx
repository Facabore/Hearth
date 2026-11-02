import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecurrenceDto } from "@/modules/ledger/ui/screens";
import {
  accountDto,
  categoryDto,
  groupDto,
  householdSpace,
  meDto,
  memberDto,
  normalized,
  octoberPage,
  spaceDto,
} from "../../../tests/support/ui/dto";
import { jsonResponse, problemResponse, type FakeHandler } from "../../../tests/support/ui/fake-api";
import { recurrenceDto } from "../../../tests/support/ui/recurrence-dto";
import { renderSpa } from "../../../tests/support/ui/spa";

const groups = [
  groupDto({ id: "g-home", name: "Hogar", categories: [categoryDto({ id: "c-rent", name: "Arriendo" })] }),
];

/** Ana's spaces over a fake /api/v1 that keeps the recurrences each write defines or moves. */
const server = (recurrences: RecurrenceDto[] = []) => {
  const state = { recurrences: [...recurrences] };
  const one = (id: string) => state.recurrences.find((r) => r.id === id);
  const moved =
    (status: RecurrenceDto["status"]): FakeHandler =>
    (_, { recurrenceId }) => {
      state.recurrences = state.recurrences.map((r) =>
        r.id === recurrenceId
          ? { ...r, status, nextOccurrence: status === "ACTIVE" ? r.startDate : null }
          : r,
      );
      return jsonResponse(one(recurrenceId!));
    };
  const routes: Record<string, FakeHandler> = {
    "GET /api/v1/me": () => jsonResponse(meDto()),
    "GET /api/v1/spaces": () =>
      jsonResponse({ items: [spaceDto(), householdSpace({ name: "Hogar", role: "VIEWER" })] }),
    "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
    "GET /api/v1/spaces/{spaceId}/transactions": () => jsonResponse(octoberPage),
    "GET /api/v1/spaces/{spaceId}/accounts": () =>
      jsonResponse({ items: [accountDto({ id: "a-bank", name: "Bancolombia" })] }),
    "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: groups }),
    "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [memberDto()] }),
    "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [] }),
    "GET /api/v1/spaces/{spaceId}/recurrences": () => jsonResponse({ items: state.recurrences }),
    "POST /api/v1/spaces/{spaceId}/recurrences": async (request) => {
      const body = (await request.json()) as { description: string; startDate: string };
      const created = recurrenceDto({
        id: `r-${state.recurrences.length + 1}`,
        description: body.description,
        startDate: body.startDate,
        nextOccurrence: body.startDate,
      });
      state.recurrences = [...state.recurrences, created];
      return jsonResponse(created, 201);
    },
    "POST /api/v1/spaces/{spaceId}/recurrences/preview": () =>
      jsonResponse({ dates: ["2026-12-01", "2027-01-01", "2027-02-01"] }),
    "GET /api/v1/spaces/{spaceId}/recurrences/{recurrenceId}": (_, { recurrenceId }) => {
      const found = one(recurrenceId!);
      return found ? jsonResponse(found) : problemResponse(404, "RecurrenceNotFound");
    },
    "GET /api/v1/spaces/{spaceId}/recurrences/{recurrenceId}/occurrences": (_, { recurrenceId }) =>
      jsonResponse({ dates: one(recurrenceId!)?.status === "ACTIVE" ? ["2026-12-01", "2027-01-01"] : [] }),
    "POST /api/v1/spaces/{spaceId}/recurrences/{recurrenceId}/pause": moved("PAUSED"),
    "POST /api/v1/spaces/{spaceId}/recurrences/{recurrenceId}/resume": moved("ACTIVE"),
  };
  return { routes, state };
};

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
  // The form starts on the person's today; the tests never read the wall clock.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-01T15:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("recurring movements in the SPA (HU-E9-09, P270)", () => {
  it("opens the list from the Recurrentes pill of Movimientos", async () => {
    const { routes } = server([recurrenceDto()]);
    const spa = renderSpa("/spaces/sp-personal/transactions", routes);
    const pill = await screen.findByRole("link", { name: "Recurrentes" }, { timeout: 5_000 });
    expect(pill).toHaveAttribute("href", "/spaces/sp-personal/recurrences");
    await userEvent.click(pill);
    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-personal/recurrences"));
    expect(await screen.findByRole("heading", { level: 1, name: "Recurrentes" })).toBeInTheDocument();
    expect(document.title).toBe("Recurrentes · Hearth");
  });

  it("defines Arriendo MONTHLY(1) AUTO from 2026-12-01, and the list shows its next occurrence (S2)", async () => {
    const { routes, state } = server();
    const spa = renderSpa("/spaces/sp-personal/recurrences/new", routes);
    await userEvent.type(await screen.findByLabelText("Monto", {}, { timeout: 5_000 }), "1200000");
    await userEvent.type(screen.getByLabelText("Descripción"), "Arriendo");
    await userEvent.click(screen.getByRole("button", { name: /Categoría/ }));
    await userEvent.click(await screen.findByRole("radio", { name: "Arriendo" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("group", { name: "El día" })).toHaveTextContent("1");
    await userEvent.click(screen.getByRole("button", { name: "Guardar recurrente" }));

    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-personal/recurrences"));
    expect(state.recurrences).toHaveLength(1);
    const row = await screen.findByRole("link", { name: /Arriendo/ });
    expect(normalized(row.textContent)).toContain("Próxima: 1/12/2026");
    const define = spa.requests.find(
      (r) => r.method === "POST" && /\/recurrences$/.test(new URL(r.url).pathname),
    );
    expect(define?.headers.get("idempotency-key")).toMatch(/.+/);
  });

  it("draws board 02's form: Monto and Descripción labelled above, Categoría and Cuenta in one card, the dates in another", async () => {
    const { routes } = server();
    renderSpa("/spaces/sp-personal/recurrences/new", routes);
    const amount = await screen.findByLabelText("Monto", {}, { timeout: 5_000 });
    expect(amount.parentElement).toHaveTextContent("$");
    expect(screen.getByText("Descripción", { selector: "label" })).not.toHaveClass("sr-only");
    const details = screen.getByRole("list", { name: "Detalles del movimiento" });
    expect(
      within(details)
        .getAllByRole("button")
        .map((b) => normalized(b.textContent)),
    ).toEqual(["Categoría Elegir categoría", "Cuenta Bancolombia"]);
    const dates = screen.getByRole("list", { name: "Fechas" });
    expect(within(dates).getAllByRole("button")).toHaveLength(2);
    expect(
      within(screen.getByRole("radiogroup", { name: "Cómo se registra" })).getByRole("radio", {
        name: "Automático",
      }),
    ).toBeChecked();
  });

  it("draws board 09 for a viewer: a paused row with its status alone, an active one with its mode", async () => {
    const { routes } = server([
      recurrenceDto(),
      recurrenceDto({ id: "r-tv", description: "Netflix", status: "PAUSED", nextOccurrence: null }),
    ]);
    renderSpa("/spaces/sp-household/recurrences", routes);
    const paused = await screen.findByRole("link", { name: /Netflix/ }, { timeout: 5_000 });
    expect(within(paused).getByText("Pausada")).toBeInTheDocument();
    expect(within(paused).queryByText("Automático")).toBeNull();
    const active = screen.getByRole("link", { name: /Arriendo/ });
    expect(within(active).getByText("Automático")).toBeInTheDocument();
  });

  it("pauses and resumes from the detail through their endpoints, and the screen reads the change", async () => {
    const { routes } = server([recurrenceDto()]);
    const spa = renderSpa("/spaces/sp-personal/recurrences/r-rent", routes);
    await userEvent.click(await screen.findByRole("button", { name: "Pausar" }, { timeout: 5_000 }));
    const resume = await screen.findByRole("button", { name: "Reanudar" });
    await userEvent.click(resume);
    expect(await screen.findByRole("button", { name: "Pausar" })).toBeInTheDocument();
    expect(
      spa.requests.filter((r) => r.method === "POST").map((r) => new URL(r.url).pathname.split("/").at(-1)),
    ).toEqual(["pause", "resume"]);
  });

  it("shows a viewer the recurrences with no define, pause or edit control (S6)", async () => {
    const { routes } = server([recurrenceDto()]);
    const spa = renderSpa("/spaces/sp-household/recurrences", routes);
    expect(
      await screen.findByText(
        "Tu rol en Hogar es Lector: puedes ver los recurrentes y sus fechas, pero no crearlos ni cambiarlos.",
        {},
        { timeout: 5_000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Nuevo" })).toBeNull();
    await userEvent.click(screen.getByRole("link", { name: /Arriendo/ }));
    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-household/recurrences/r-rent"));
    expect(await screen.findByRole("heading", { level: 1, name: "Arriendo" })).toBeInTheDocument();
    for (const name of ["Pausar", "Extender", "Terminar", "Reanudar"])
      expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByRole("link", { name: "Editar Arriendo" })).toBeNull();

    await spa.router.navigate({ href: "/spaces/sp-household/recurrences/new" });
    const form = await screen.findByRole("heading", { level: 1, name: "Nuevo movimiento recurrente" });
    expect(
      within(form.closest("div")!.parentElement!).queryByRole("button", { name: "Guardar recurrente" }),
    ).toBeNull();
  });
});
