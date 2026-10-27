import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import {
  accountDto,
  categoryDto,
  groupDto,
  householdSpace,
  memberDto,
  spaceDto,
} from "../../../../../tests/support/ui/dto";
import { fakeApi } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Problem } from "@/shared/ui/api/problem";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import type { RecordInitial } from "../edit/edit-initial";
import type { SharedExpenseContext } from "../split/shared-context";
import { RecordForm, type RecordEdit } from "./record-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T04:30:00Z"));
});
afterEach(() => vi.useRealTimers());

const groceries = categoryDto({
  id: "c-groceries",
  name: "Groceries",
  subcategories: [categoryDto({ id: "c-veg", name: "Vegetables", parentCategoryId: "c-groceries" })],
});
const groups = [groupDto({ id: "g-food", name: "Food", categories: [groceries] })];
const accounts = [
  accountDto({ id: "a-bank", name: "Bancolombia" }),
  accountDto({ id: "a-visa", name: "Visa", type: "CREDIT_CARD", icon: "card" }),
];
const initial: RecordInitial = {
  kind: "EXPENSE",
  amount: "85.000",
  description: "Market",
  category: { categoryId: "c-groceries", subcategoryId: "c-veg" },
  accountId: "a-bank",
  toAccountId: null,
  when: { date: "2026-10-20", wall: { hour: 12, minute: 30 } },
  split: null,
};
const precondition: Problem = {
  code: "PreconditionFailed",
  status: 412,
  requestId: "req-test",
  errors: [],
  field: null,
};
const edit = (overrides: Partial<RecordEdit> = {}): RecordEdit => ({
  initial,
  backHref: "/spaces/sp-personal/transactions?tx=t-1",
  onSave: vi.fn(async () => null),
  ...overrides,
});
const personal = (value: RecordEdit, people: [] | undefined = []) => {
  const { api, requests } = fakeApi({});
  const view = renderWithIntl(
    <RecordForm
      space={spaceDto()}
      accounts={accounts}
      groups={groups}
      formats={BUILT_IN_FORMATS}
      initialKind="EXPENSE"
      initialNow="2026-11-01T04:30:00.000Z"
      timeZone="America/Bogota"
      people={people}
      api={api}
      edit={value}
    />,
  );
  return { ...view, requests };
};

describe("record form in edit mode (ruling P191)", () => {
  it("starts from the transaction, hides the kind tabs and the split with someone, and hands Save to onSave", async () => {
    const value = edit();
    const { container, requests } = personal(value);
    expect(screen.getByRole("heading", { level: 1, name: "Editar movimiento" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByText("Tipo: Gasto")).toBeInTheDocument();
    expect(screen.getByLabelText("Monto")).toHaveValue("85.000");
    expect(screen.getByLabelText("Descripción")).toHaveValue("Market");
    expect(screen.getByRole("button", { name: /Categoría/ })).toHaveTextContent("Groceries › Vegetables");
    expect(screen.getByRole("button", { name: /Cuenta/ })).toHaveTextContent("Bancolombia");
    expect(screen.getByTestId("when-chip")).toHaveTextContent("20/10/2026 · 12:30");
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/transactions?tx=t-1",
    );
    expect(screen.queryByRole("button", { name: /Dividir con alguien/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar gasto" })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);

    await userEvent.clear(screen.getByLabelText("Monto"));
    await userEvent.type(screen.getByLabelText("Monto"), "95000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(value.onSave).toHaveBeenCalledTimes(1);
    expect(value.onSave).toHaveBeenCalledWith(
      {
        kind: "EXPENSE",
        body: expect.objectContaining({
          amount: { amount: "9500000", currency: "COP" },
          accountId: "a-bank",
          categoryId: "c-veg",
          description: "Market",
          date: "2026-10-20",
          timeZone: "America/Bogota",
        }),
      },
      { when: { date: "2026-10-20", wall: { hour: 12, minute: 30 } } },
    );
    // Editing never POSTs a new record.
    expect(requests).toEqual([]);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("still offers the split with someone when it is not an edit", async () => {
    const { api } = fakeApi({});
    renderWithIntl(
      <RecordForm
        space={spaceDto()}
        accounts={accounts}
        groups={groups}
        formats={BUILT_IN_FORMATS}
        initialKind="EXPENSE"
        initialNow="2026-11-01T04:30:00.000Z"
        timeZone="America/Bogota"
        people={[]}
        api={api}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Más opciones" }));
    expect(screen.getByRole("button", { name: /Dividir con alguien/ })).toBeInTheDocument();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  it("names a category that was archived since the record was made, and keeps it in the request", async () => {
    const old = categoryDto({ id: "c-old", name: "Gym", archivedAt: "2026-09-01T00:00:00.000Z" });
    const value = edit({
      initial: { ...initial, category: { categoryId: "c-old", subcategoryId: null } },
    });
    const { api } = fakeApi({});
    renderWithIntl(
      <RecordForm
        space={spaceDto()}
        accounts={accounts}
        groups={[...groups, groupDto({ id: "g-old", name: "Old", categories: [old] })]}
        formats={BUILT_IN_FORMATS}
        initialKind="EXPENSE"
        initialNow="2026-11-01T04:30:00.000Z"
        timeZone="America/Bogota"
        api={api}
        edit={value}
      />,
    );
    expect(screen.getByRole("button", { name: /Categoría/ })).toHaveTextContent("Gym");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(value.onSave).toHaveBeenCalledWith(
      { kind: "EXPENSE", body: expect.objectContaining({ categoryId: "c-old" }) },
      expect.anything(),
    );
  });

  it("shows an income's and a transfer's own labels", () => {
    personal(
      edit({
        initial: { ...initial, kind: "TRANSFER", category: null, accountId: "a-bank", toAccountId: "a-visa" },
      }),
    );
    expect(screen.getByText("Tipo: Transferencia")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Desde/ })).toHaveTextContent("Bancolombia");
    expect(screen.getByRole("button", { name: /Hacia/ })).toHaveTextContent("Visa");
  });

  it("shows the problem onSave answers above the button, with the problem's action, and can save again", async () => {
    const onSave = vi.fn(async () => precondition);
    personal(
      edit({
        onSave,
        problemAction: (problem) => <button type="button">Cargar la última versión ({problem.code})</button>,
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(
      await screen.findByText(
        "Alguien cambió esto mientras lo editabas. Recarga para ver la última versión.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cargar la última versión (PreconditionFailed)" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("shows a problem from a field next to the field and no action", async () => {
    personal(
      edit({
        onSave: async () => ({
          code: "PeriodClosed",
          status: 409,
          requestId: "req-test",
          errors: [],
          field: null,
        }),
        problemAction: () => <button type="button">Cargar la última versión</button>,
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(await screen.findByText(/Ese periodo está cerrado/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cargar la última versión" })).not.toBeInTheDocument();
  });

  it("does not run the save twice while it is pending", async () => {
    let finish: (problem: Problem | null) => void = () => undefined;
    const onSave = vi.fn(() => new Promise<Problem | null>((resolve) => (finish = resolve)));
    personal(edit({ onSave }));
    await userEvent.dblClick(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    finish(null);
  });
});

describe("a shared expense in edit mode (ruling P192)", () => {
  const members = [
    memberDto(),
    memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" }),
  ];
  const context: SharedExpenseContext = {
    members,
    meMemberId: "m-ana",
    myAccounts: [accountDto({ id: "a-bank", name: "Bancolombia" })],
    funds: [],
  };
  const sharedInitial: RecordInitial = {
    ...initial,
    amount: "300.000",
    category: { categoryId: "c-groceries", subcategoryId: null },
    accountId: null,
    split: {
      payer: { kind: "ME", memberId: "m-ana", accountId: "a-bank" },
      method: "PERCENT",
      selected: ["m-ana", "m-juan"],
      values: { "m-ana": "40", "m-juan": "60" },
      chosen: true,
    },
  };

  it("prefills the payer and the split, never asks for the plan's split, and sends payments and split", async () => {
    const value = edit({ initial: sharedInitial, backHref: "/spaces/sp-household/transactions?tx=t-1" });
    const { api, requests } = fakeApi({});
    renderWithIntl(
      <RecordForm
        space={householdSpace()}
        accounts={[]}
        groups={groups}
        formats={BUILT_IN_FORMATS}
        initialKind="EXPENSE"
        initialNow="2026-11-01T04:30:00.000Z"
        timeZone="America/Bogota"
        shared={context}
        api={api}
        edit={value}
      />,
    );
    expect(screen.getByRole("button", { name: /Pagas tú|Pagó/ })).toHaveTextContent(
      "Pagas tú desde Bancolombia (tu cuenta personal)",
    );
    expect(screen.getByRole("button", { name: /División/ })).toHaveTextContent(/Con Ana y Juan/);
    // The plan's split is asked 250 ms after the category last changed; in an edit it is never asked.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(requests).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    expect(value.onSave).toHaveBeenCalledWith(
      {
        kind: "EXPENSE",
        body: expect.objectContaining({
          amount: { amount: "30000000", currency: "COP" },
          payments: [
            { memberId: "m-ana", accountId: "a-bank", amount: { amount: "30000000", currency: "COP" } },
          ],
          split: {
            method: "PERCENT",
            participants: [
              { memberId: "m-ana", percent: "40" },
              { memberId: "m-juan", percent: "60" },
            ],
          },
        }),
      },
      expect.anything(),
    );
    expect(requests).toEqual([]);
  });
});
