import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import es from "@/i18n/messages/es.json";
import { BUILT_IN_FORMATS, formatDate } from "@/shared/ui/format/formatters";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import {
  categoryDto,
  cop,
  groupDto,
  householdSpace,
  normalized,
  spaceDto,
} from "../../../../../tests/support/ui/dto";
import { recurrenceDto } from "../../../../../tests/support/ui/recurrence-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { RecurringList } from "./recurring-list";

const groups = [
  groupDto({
    id: "g-home",
    name: "Hogar",
    categories: [
      categoryDto({ id: "c-rent", name: "Arriendo" }),
      categoryDto({ id: "c-tv", name: "Streaming" }),
    ],
  }),
];
const names = {
  accountNames: { "a-bank": "Bancolombia", "a-fund": "Fondo Hogar" },
  memberNames: { "m-ana": "Ana", "m-juan": "Juan" },
};
const netflix = recurrenceDto({
  id: "r-tv",
  description: "Netflix",
  amount: cop(38_900),
  schedule: { kind: "MONTHLY", day: 18 },
  status: "PAUSED",
  nextOccurrence: null,
  categoryId: "c-tv",
});
const insurance = recurrenceDto({
  id: "r-car",
  description: "Seguro del carro",
  status: "ENDED",
  endDate: "2026-10-15",
  nextOccurrence: null,
});

const renderList = (space = spaceDto(), recurrences = [recurrenceDto(), netflix, insurance]) =>
  renderWithIntl(
    <RecurringList
      space={space}
      recurrences={recurrences}
      groups={groups}
      {...names}
      formats={BUILT_IN_FORMATS}
      timeZone="America/Bogota"
    />,
  );

describe("the recurring list (HU-E9-09, P270)", () => {
  it("says since when a paused one is paused, as a day in the person's zone", () => {
    renderList(spaceDto(), [
      recurrenceDto({
        id: "r-tv",
        description: "TV",
        status: "PAUSED",
        nextOccurrence: null,
        pausedAt: "2026-11-03T04:00:00.000Z",
      }),
    ]);
    expect(screen.getByText("En pausa desde el 2/11/2026")).toBeInTheDocument();
  });

  it("lists a defined recurrence with its signed amount, schedule, next date and badges (S2)", () => {
    renderList();
    const active = screen.getByRole("region", { name: "Activos · 1" });
    const rent = within(active).getByRole("link", { name: /Arriendo/ });
    expect(rent).toHaveAttribute("href", "/spaces/sp-personal/recurrences/r-rent");
    const text = normalized(rent.textContent);
    expect(text).toContain("−$ 1.200.000");
    expect(text).toContain("Gasto · Cada mes, el día 1 · Bancolombia");
    expect(text).toContain(`Próxima: ${formatDate("2026-12-01", BUILT_IN_FORMATS)}`);
    expect(text).toContain("Próxima: 1/12/2026");
    expect(within(rent).getByText("Activa")).toBeInTheDocument();
    expect(within(rent).getByText("Automático")).toBeInTheDocument();
  });

  it("puts paused and ended ones in their own section, with their status", () => {
    renderList();
    const inactive = screen.getByRole("region", { name: "En pausa y terminados" });
    const rows = within(inactive).getAllByRole("link");
    expect(rows.map((row) => within(row).getByText(/Pausada|Terminada/).textContent)).toEqual([
      "Pausada",
      "Terminada",
    ]);
    expect(normalized(rows[1]!.textContent)).toContain("Terminó el 15/10/2026");
  });

  it("draws board 01's inactive rows: only their status badge, a neutral icon tile, and an ended one's name muted", () => {
    renderList();
    const active = within(screen.getByRole("region", { name: "Activos · 1" })).getByRole("link");
    const [paused, ended] = within(
      screen.getByRole("region", { name: "En pausa y terminados" }),
    ).getAllByRole("link");
    const tile = (row: HTMLElement) =>
      row.querySelector("span[aria-hidden='true']")?.getAttribute("style") ?? "";
    // Paused: "Pausada" alone, with no mode badge; the active row keeps its mode.
    expect(within(paused!).queryByText("Automático")).toBeNull();
    expect(within(active).getByText("Automático")).toBeInTheDocument();
    expect(within(ended!).queryByText("Automático")).toBeNull();
    // The category's own icon, on a neutral tile while it records nothing.
    expect(tile(paused!)).toContain("graphite");
    expect(tile(ended!)).toContain("graphite");
    expect(tile(active)).toContain("sage");
    // An ended one's name and amount are muted; a paused one's stay in ink.
    expect(within(ended!).getByText("Seguro del carro")).toHaveClass("text-muted");
    expect(within(paused!).getByText("Netflix")).toHaveClass("text-ink");
  });

  it("names a shared expense's payer and account, and a fund that pays", () => {
    renderList(householdSpace(), [
      recurrenceDto({ payerMemberId: null, sourceAccountId: "a-fund" }),
      recurrenceDto({ id: "r-2", description: "Energía", mode: "CONFIRM" }),
    ]);
    const [rent, power] = screen.getAllByRole("link", { name: /Arriendo|Energía/ });
    expect(normalized(rent!.textContent)).toContain("Gasto · Cada mes, el día 1 · Fondo Hogar");
    expect(normalized(power!.textContent)).toContain("Gasto · Cada mes, el día 1 · Ana · Bancolombia");
    expect(within(power!).getByText("Para confirmar")).toBeInTheDocument();
  });

  it("offers Nuevo to a member who records money, with a way back to Movimientos", async () => {
    const { container } = renderList();
    expect(screen.getByRole("link", { name: "Nuevo" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/recurrences/new",
    );
    expect(screen.getByRole("link", { name: es.common.back })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/transactions",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows a viewer the role note and no define control (S6)", async () => {
    const { container } = renderList(householdSpace({ name: "Hogar", role: "VIEWER" }));
    expect(
      screen.getByText(
        "Tu rol en Hogar es Lector: puedes ver los recurrentes y sus fechas, pero no crearlos ni cambiarlos.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Nuevo" })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("says when the space has none yet, and offers to add one", () => {
    renderList(spaceDto(), []);
    expect(screen.getByText(es.recurrences.list.empty)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: es.recurrences.list.add })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/recurrences/new",
    );
  });
});
