import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, householdSpace, normalized } from "../../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { ToastProvider } from "@/shared/ui/molecules/toast-provider";
import { PendingOccurrencesScreen, type PendingItem } from "./pending-occurrences-screen";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

const internet: PendingItem = {
  id: "o-internet",
  recurrenceId: "r-internet",
  name: "Internet",
  type: "EXPENSE",
  date: "2026-12-05",
  suggested: cop(95_000),
  details: ["Juan", "Nequi"],
};
const energy: PendingItem = {
  id: "o-energy",
  recurrenceId: "r-energy",
  name: "Energía",
  type: "EXPENSE",
  date: "2026-12-10",
  suggested: cop(180_000),
  details: ["Ana", "Bancolombia"],
};

type Props = ComponentProps<typeof PendingOccurrencesScreen>;
const show = (overrides: Partial<Props> = {}) => {
  const props: Props = {
    space: householdSpace({ name: "Hogar" }),
    items: [internet, energy],
    formats: BUILT_IN_FORMATS,
    canAct: true,
    onConfirm: vi.fn(async () => ({ ok: true as const, transactionId: "t-energy" })),
    onSkip: vi.fn(async () => ({ ok: true as const, next: "2027-01-10" })),
    ...overrides,
  };
  const view = renderWithIntl(
    <ToastProvider>
      <PendingOccurrencesScreen {...props} />
    </ToastProvider>,
  );
  return { ...view, props };
};
const card = (name: string) => screen.getByRole("article", { name });

describe("Por confirmar (HU-E9-09, ruling P270)", () => {
  it("shows each pending occurrence with its date, suggestion, a field for the real amount and both actions", async () => {
    const { container } = show();
    expect(screen.getByRole("heading", { level: 1, name: "Por confirmar" })).toBeInTheDocument();
    expect(screen.getByText("Hogar · 2 pendientes")).toBeInTheDocument();
    const text = normalized(card("Energía").textContent);
    expect(text).toContain("Pendiente desde el 10/12/2026");
    expect(text).toContain("Sugerido: $ 180.000 · Ana · Bancolombia");
    expect(text).toContain("Gasto");
    expect(within(card("Energía")).getByRole("textbox", { name: "Monto real de Energía" })).toHaveValue(
      "180.000",
    );
    expect(within(card("Energía")).getByRole("button", { name: "Omitir" })).toBeEnabled();
    expect(within(card("Energía")).getByRole("button", { name: "Confirmar" })).toBeEnabled();
    expect(screen.getByText(/Confirmar registra el gasto con el monto real/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/transactions",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("draws board 07's real amount: one large field with its symbol inside, the difference under it", async () => {
    show();
    const field = within(card("Energía")).getByRole("textbox", { name: "Monto real de Energía" });
    // The symbol sits in the field's own box, at the figure's 24 px semibold, never a small separate prefix.
    const box = field.parentElement!;
    expect(box).toHaveTextContent("$");
    expect(within(box).getByText("$")).toHaveClass("text-2xl", "font-semibold");
    expect(field).toHaveClass("text-2xl", "font-semibold");
    await userEvent.clear(field);
    await userEvent.type(field, "205300");
    expect(field).toHaveAccessibleDescription(/25\.300 más que lo sugerido$/);
  });

  it("says the difference from the suggestion in words, above and below it", async () => {
    show();
    const field = within(card("Energía")).getByRole("textbox", { name: "Monto real de Energía" });
    await userEvent.clear(field);
    await userEvent.type(field, "205300");
    expect(normalized(card("Energía").textContent)).toContain("$ 25.300 más que lo sugerido");
    await userEvent.clear(field);
    await userEvent.type(field, "170000");
    expect(normalized(card("Energía").textContent)).toContain("$ 10.000 menos que lo sugerido");
  });

  it("confirms Energía with 205.300 in minor units, toasts Gasto guardado with Ver, and takes the item away (S4)", async () => {
    const { props } = show();
    const field = within(card("Energía")).getByRole("textbox", { name: "Monto real de Energía" });
    await userEvent.clear(field);
    await userEvent.type(field, "205300");
    await userEvent.click(within(card("Energía")).getByRole("button", { name: "Confirmar" }));
    expect(props.onConfirm).toHaveBeenCalledWith(
      energy,
      { amount: "20530000", currency: "COP" },
      expect.any(String),
    );
    const toast = await screen.findByRole("status");
    await waitFor(() => expect(normalized(toast.textContent)).toContain("Gasto guardado"));
    await userEvent.click(within(toast).getByRole("button", { name: "Ver" }));
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-household/transactions?tx=t-energy");
    expect(screen.queryByRole("article", { name: "Energía" })).not.toBeInTheDocument();
    expect(card("Internet")).toBeInTheDocument();
  });

  it("refuses an amount it cannot read without calling the API, and keeps the item", async () => {
    const { props } = show();
    const field = within(card("Energía")).getByRole("textbox", { name: "Monto real de Energía" });
    await userEvent.clear(field);
    await userEvent.click(within(card("Energía")).getByRole("button", { name: "Confirmar" }));
    expect(props.onConfirm).not.toHaveBeenCalled();
    expect(normalized(card("Energía").textContent)).toContain("Escribe un monto mayor que cero.");
  });

  it("shows the API's refusal on the item and keeps it", async () => {
    show({
      onConfirm: vi.fn(async () => ({
        ok: false as const,
        problem: { status: 409, code: "PeriodClosed", requestId: "req-1", errors: [], field: null },
      })),
    });
    await userEvent.click(within(card("Energía")).getByRole("button", { name: "Confirmar" }));
    expect(await within(card("Energía")).findByRole("alert")).toHaveTextContent(/./);
    expect(card("Energía")).toBeInTheDocument();
  });

  it("skips an occurrence, takes it away and toasts the recurrence's next date from the API (S5)", async () => {
    const { props } = show();
    await userEvent.click(within(card("Energía")).getByRole("button", { name: "Omitir" }));
    expect(props.onSkip).toHaveBeenCalledWith(energy);
    const toast = await screen.findByRole("status");
    await waitFor(() =>
      expect(normalized(toast.textContent)).toContain("Energía omitida. Sigue el 10/1/2027."),
    );
    expect(screen.queryByRole("article", { name: "Energía" })).not.toBeInTheDocument();
  });

  it("gives a VIEWER the role note and no field, confirm or skip (S6)", async () => {
    const { container } = show({ canAct: false, space: householdSpace({ name: "Hogar", role: "VIEWER" }) });
    expect(
      screen.getByText(
        "Tu rol en Hogar es Lector: puedes ver lo que está por confirmar, pero no confirmarlo ni omitirlo.",
      ),
    ).toBeInTheDocument();
    expect(normalized(card("Energía").textContent)).toContain("Sugerido: $ 180.000 · Ana · Bancolombia");
    expect(screen.queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Omitir" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("says when nothing is waiting", () => {
    show({ items: [] });
    expect(screen.getByText("No tienes nada por confirmar.")).toBeInTheDocument();
  });
});

describe("Por confirmar's cards carry their category's icon (P270)", () => {
  it("shows the occurrence's category icon beside its name, and a card without one stays as it is", () => {
    show({
      items: [{ ...energy, category: { icon: { kind: "SYMBOL", name: "bolt" }, color: "AMBER" } }, internet],
    });
    const [withIcon, without] = screen.getAllByRole("article");
    expect(withIcon!.querySelector("span[aria-hidden='true'].rounded-xl")).not.toBeNull();
    expect(without!.querySelector("span[aria-hidden='true'].rounded-xl")).toBeNull();
  });
});
