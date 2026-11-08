import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import {
  accountDto,
  categoryDto,
  groupDto,
  householdSpace,
  memberDto,
  spaceDto,
  transactionDto,
} from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
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

const groceries = categoryDto({ id: "c-groceries", name: "Groceries" });
const groups = [groupDto({ id: "g-food", name: "Food", categories: [groceries] })];
const accounts = [accountDto({ id: "a-bank", name: "Bancolombia" })];
const shared: SharedExpenseContext = {
  members: [memberDto(), memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" })],
  meMemberId: "m-ana",
  myAccounts: [accountDto({ id: "a-bank", name: "Bancolombia" })],
  funds: [],
};
const initial: RecordInitial = {
  kind: "EXPENSE",
  amount: "85.000",
  description: "Market",
  category: { categoryId: "c-groceries", subcategoryId: null },
  accountId: "a-bank",
  toAccountId: null,
  when: { date: "2026-10-20", wall: { hour: 12, minute: 30 } },
  split: null,
};
const edit = (value: RecordInitial): RecordEdit => ({
  initial: value,
  backHref: "/spaces/sp-personal/transactions?tx=t-1",
  onSave: vi.fn(async () => null),
});

const personal = (api: Api, options: { edit?: RecordEdit } = {}) =>
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
      {...options}
    />,
  );
const household = (api: Api, options: { edit?: RecordEdit } = {}) =>
  renderWithIntl(
    <RecordForm
      space={householdSpace()}
      accounts={[]}
      groups={groups}
      formats={BUILT_IN_FORMATS}
      initialKind="EXPENSE"
      initialNow="2026-11-01T04:30:00.000Z"
      timeZone="America/Bogota"
      shared={shared}
      api={api}
      {...options}
    />,
  );
const amount = () => screen.getByLabelText("Monto");
const more = () => screen.getByRole("button", { name: /^(Más|Menos) opciones$/ });

/** Whether `a` comes before `b` in the document. */
const before = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("the amount takes the form's keypad (ruling P291, board B1 · 01)", () => {
  it("draws the keypad, keeps the phone's keyboard down, and still types from a physical one", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/expenses": () => jsonResponse(transactionDto({ id: "t-new" }), 201),
    });
    personal(api);
    expect(amount()).toHaveAttribute("inputmode", "none");
    expect(amount()).toHaveAttribute("id", "record-amount");
    for (const key of ["4", "5", "000"]) await userEvent.click(screen.getByRole("button", { name: key }));
    expect(amount()).toHaveValue("45.000");
    await userEvent.type(amount(), "0");
    expect(amount()).toHaveValue("450.000");
    await userEvent.click(screen.getByRole("button", { name: "Groceries" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(await requests[0]!.json()).toMatchObject({ amount: { amount: "45000000", currency: "COP" } });
  });

  it("focuses the amount when the form opens for a new record", () => {
    personal(fakeApi({}).api);
    expect(amount()).toHaveFocus();
  });

  it("leaves the focus alone when the form opens to edit a record", () => {
    personal(fakeApi({}).api, { edit: edit(initial) });
    expect(amount()).not.toHaveFocus();
  });
});

describe("the board's order (ruling P291, board B1 · 01)", () => {
  it("runs tabs, amount, description, tiles, the split row, the chips, the keypad and Guardar, axe clean", async () => {
    const { container } = personal(fakeApi({}).api);
    const order = [
      screen.getByRole("tablist"),
      amount(),
      screen.getByLabelText("Descripción"),
      screen.getByRole("group", { name: "Categoría" }),
      screen.getByRole("button", { name: "¿Lo compartiste? Dividir con alguien" }),
      screen.getByRole("group", { name: "Detalles del movimiento" }),
      screen.getByRole("button", { name: "Borrar" }),
      screen.getByRole("button", { name: "Guardar gasto" }),
    ];
    for (const [i, element] of order.slice(1).entries()) expect(before(order[i]!, element)).toBe(true);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("names the account and the date and time in compact chips, the space first (P308); the account and date open", async () => {
    personal(fakeApi({}).api);
    const chips = screen.getByRole("group", { name: "Detalles del movimiento" });
    expect(within(chips).getByRole("button", { name: /Cuenta/ })).toHaveTextContent("Bancolombia");
    expect(within(chips).getByTestId("when-chip")).toHaveTextContent("Hoy · 23:30");
    expect(within(chips).queryByText(spaceDto().name)).toBeNull();
    // Ruling P308: the space is named above the kind tabs, since what follows depends on it.
    const recordIn = screen.getByText("Registrar en");
    expect(recordIn.parentElement).toHaveTextContent(spaceDto().name);
    expect(
      recordIn.compareDocumentPosition(screen.getByRole("tablist")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(chips).getAllByRole("button")).toHaveLength(2);
    for (const chip of within(chips).getAllByRole("button")) expect(chip).toHaveClass("min-h-11");
    await userEvent.click(within(chips).getByRole("button", { name: /Cuenta/ }));
    expect(screen.getByRole("dialog", { name: "Cuenta" })).toBeInTheDocument();
  });

  it("chooses a category from its tile, and a subcategory from its chip, a second tap clearing it", async () => {
    const withSubs = [
      groupDto({
        id: "g-food",
        name: "Food",
        categories: [
          categoryDto({
            id: "c-groceries",
            name: "Groceries",
            subcategories: [
              categoryDto({ id: "c-veg", name: "Vegetables", parentCategoryId: "c-groceries" }),
            ],
          }),
          categoryDto({ id: "c-dining", name: "Dining" }),
        ],
      }),
    ];
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/expenses": () => jsonResponse(transactionDto({ id: "t-new" }), 201),
    });
    renderWithIntl(
      <RecordForm
        space={spaceDto()}
        accounts={accounts}
        groups={withSubs}
        formats={BUILT_IN_FORMATS}
        initialKind="EXPENSE"
        initialNow="2026-11-01T04:30:00.000Z"
        timeZone="America/Bogota"
        api={api}
      />,
    );
    expect(screen.queryByRole("group", { name: "Subcategorías de Groceries" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Groceries" }));
    expect(screen.getByRole("button", { name: "Groceries" })).toHaveAttribute("aria-pressed", "true");
    const subs = screen.getByRole("group", { name: "Subcategorías de Groceries" });
    await userEvent.click(within(subs).getByRole("button", { name: "Vegetables" }));
    expect(within(subs).getByRole("button", { name: "Vegetables" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(subs).getByRole("button", { name: "Vegetables" }));
    expect(within(subs).getByRole("button", { name: "Vegetables" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(within(subs).getByRole("button", { name: "Vegetables" }));
    // A second tap on the chosen tile opens the picker, as the last tile does.
    await userEvent.click(screen.getByRole("button", { name: "Groceries" }));
    expect(await screen.findByRole("dialog", { name: "Categoría" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Dining" }));
    expect(screen.queryByRole("group", { name: "Subcategorías de Groceries" })).toBeNull();
    await userEvent.type(amount(), "85000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(await requests[0]!.json()).toMatchObject({ categoryId: "c-dining" });
  });
});

describe("a category created from the picker (ruling P308)", () => {
  it("offers no new category without a way to hand it back", async () => {
    personal(fakeApi({}).api);
    await userEvent.click(screen.getByRole("button", { name: "Elegir categoría" }));
    const picker = await screen.findByRole("dialog", { name: "Categoría" });
    expect(within(picker).getByText("Categorías de Personal")).toBeInTheDocument();
    expect(within(picker).queryByRole("button", { name: "Nueva categoría" })).toBeNull();
  });

  it("comes back chosen in the form, keeps what was typed, and the save records the movement in it", async () => {
    const onCategoryCreated = vi.fn();
    // The route puts the new category in the tree it hands the form, as this harness does.
    function Harness({ api }: { readonly api: Api }) {
      const [tree, setTree] = useState(groups);
      return (
        <RecordForm
          space={householdSpace({ name: "Viaje" })}
          accounts={accounts}
          groups={tree}
          formats={BUILT_IN_FORMATS}
          initialKind="EXPENSE"
          initialNow="2026-11-01T04:30:00.000Z"
          timeZone="America/Bogota"
          api={api}
          onCategoryCreated={(made) => {
            onCategoryCreated(made);
            setTree((list) =>
              list.map((g) =>
                g.id === made.groupId
                  ? { ...g, categories: [...g.categories, { ...made, subcategories: [] }] }
                  : g,
              ),
            );
          }}
        />
      );
    }
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/categories": async (request) => {
        const body = await request.clone().json();
        return jsonResponse(categoryDto({ id: "c-hotel", ...body }), 201);
      },
      "POST /api/v1/spaces/{spaceId}/expenses": () => jsonResponse(transactionDto({ id: "t-new" }), 201),
    });
    renderWithIntl(<Harness api={api} />);
    await userEvent.type(amount(), "45000");
    await userEvent.click(screen.getByRole("button", { name: "Elegir categoría" }));
    const picker = await screen.findByRole("dialog", { name: "Categoría" });
    expect(within(picker).getByText("Categorías de Viaje")).toBeInTheDocument();
    await userEvent.click(within(picker).getByRole("button", { name: "Nueva categoría" }));
    const sheet = await screen.findByRole("dialog", { name: "Nueva categoría" });
    expect(within(sheet).getByText("En Viaje · la verán todos en el espacio")).toBeInTheDocument();
    await userEvent.type(await within(sheet).findByLabelText("Nombre"), "Bebidas en el hotel");
    await userEvent.click(within(sheet).getByRole("button", { name: "Crear y usar en el gasto" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onCategoryCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c-hotel", groupId: "g-food" }),
    );
    // The new category is the chosen tile, and the amount typed before is still there.
    expect(screen.getByRole("button", { name: "Bebidas en el hotel" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(amount()).toHaveValue("45.000");
    const categoryRequest = requests.find((r) => new URL(r.url).pathname.endsWith("/categories"))!;
    expect(new URL(categoryRequest.url).pathname).toBe(`/api/v1/spaces/${householdSpace().id}/categories`);
    expect(await categoryRequest.clone().json()).toEqual({ groupId: "g-food", name: "Bebidas en el hotel" });
  });
});

describe("Más opciones folds the split (#171, S3)", () => {
  it("has nothing to fold in a personal space: the split with someone is a row of its own (U11, #222)", () => {
    personal(fakeApi({}).api);
    expect(screen.queryByRole("button", { name: /^(Más|Menos) opciones$/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "¿Lo compartiste? Dividir con alguien" })).toBeVisible();
  });

  it("keeps who paid on screen, folds only the division of a shared expense, and keeps Guardar last", async () => {
    household(fakeApi({}).api);
    expect(more()).toHaveAttribute("aria-expanded", "false");
    // Board E9-06 · 01: "Pagó Ana desde Bancolombia", above a folded Más opciones, before the keypad.
    const payer = screen.getByRole("button", { name: "Pagó Ana desde Bancolombia" });
    expect(payer).toBeVisible();
    expect(within(payer).getByText("Pagó").tagName).toBe("STRONG");
    expect(before(payer, more())).toBe(true);
    expect(before(more(), screen.getByRole("button", { name: "Borrar" }))).toBe(true);
    expect(screen.queryByRole("button", { name: /División/ })).not.toBeInTheDocument();
    await userEvent.click(more());
    expect(screen.getByRole("button", { name: /Pagó Ana/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /División/ })).toBeVisible();
    const buttons = screen.getAllByRole("button");
    expect(buttons.at(-1)).toHaveAccessibleName("Guardar gasto");
  });

  it("still asks for the plan's split while folded, and saves without a split for it (P167)", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": () =>
        jsonResponse({
          method: "BY_ALLOCATION",
          availableMethods: ["BY_ALLOCATION", "EQUAL"],
          lineId: "l-home",
          shares: [
            { memberId: "m-ana", amount: { amount: "80000000", currency: "COP" } },
            { memberId: "m-juan", amount: { amount: "120000000", currency: "COP" } },
          ],
        }),
      "POST /api/v1/spaces/{spaceId}/expenses": () =>
        jsonResponse({ ...transactionDto({ id: "t-new" }), warnings: [] }, 201),
    });
    household(api);
    await userEvent.type(amount(), "2000000");
    await userEvent.click(screen.getByRole("button", { name: "Elegir categoría" }));
    await userEvent.click(await screen.findByRole("radio", { name: "Groceries" }));
    await waitFor(() => expect(requests.some((r) => r.url.includes("default-split"))).toBe(true));
    expect(more()).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(more());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /División/ })).toHaveTextContent("según el plan"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(await requests.find((r) => r.method === "POST")!.json()).not.toHaveProperty("split");
  });

  it("starts open when editing a record that already has a split", () => {
    household(fakeApi({}).api, {
      edit: edit({
        ...initial,
        accountId: null,
        split: {
          payer: { kind: "ME", memberId: "m-ana", accountId: "a-bank" },
          method: "EQUAL",
          selected: ["m-ana", "m-juan"],
          values: {},
          chosen: true,
        },
      }),
    });
    expect(more()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /División/ })).toBeVisible();
  });

  it("opens by itself when the API's split problem lands inside it, so the error is never hidden", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": () =>
        jsonResponse({ method: "EQUAL", availableMethods: ["EQUAL"], lineId: null, shares: [] }),
      "POST /api/v1/spaces/{spaceId}/expenses": () => problemResponse(422, "InvalidSplit"),
    });
    household(api);
    await userEvent.type(amount(), "300000");
    await userEvent.click(screen.getByRole("button", { name: "Elegir categoría" }));
    await userEvent.click(await screen.findByRole("radio", { name: "Groceries" }));
    expect(more()).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(await screen.findByText("Revisa cómo se divide el gasto.")).toBeVisible();
    // While the problem stands there is no Menos opciones to fold it away again.
    expect(screen.queryByRole("button", { name: /^(Más|Menos) opciones$/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /División/ })).toHaveAccessibleDescription(
      "Revisa cómo se divide el gasto.",
    );
  });
});

describe("the description is a compact field with its label for screen readers (#171, S3)", () => {
  it("keeps the label Descripción and says it is optional in the placeholder", () => {
    personal(fakeApi({}).api);
    expect(screen.getByLabelText("Descripción")).toHaveAttribute("placeholder", "Descripción (opcional)");
  });
});
