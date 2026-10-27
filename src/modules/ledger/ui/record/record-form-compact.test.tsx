import { screen, waitFor, within } from "@testing-library/react";
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

describe("the amount takes the phone's own keyboard (#171, S3)", () => {
  it("renders no keypad, and the amount asks for the decimal keyboard", () => {
    personal(fakeApi({}).api);
    expect(amount()).toHaveAttribute("inputmode", "decimal");
    expect(amount()).toHaveAttribute("id", "record-amount");
    for (const key of ["0", "1", "9", "000", "Borrar"])
      expect(screen.queryByRole("button", { name: key })).not.toBeInTheDocument();
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

describe("category, account and date are 48 px rows in one card (#171, S3)", () => {
  it("lists the three rows in order, each with its label first, and keeps axe clean", async () => {
    const { container } = personal(fakeApi({}).api);
    const card = screen.getByRole("list", { name: "Detalles del movimiento" });
    const rows = within(card).getAllByRole("button");
    expect(rows.map((row) => row.firstElementChild?.nextElementSibling?.textContent)).toEqual([
      "Categoría",
      "Cuenta",
      "Fecha",
    ]);
    for (const row of rows) expect(row).toHaveClass("min-h-12");
    expect(rows[2]).toBe(screen.getByTestId("when-chip"));
    await userEvent.click(rows[1]!);
    expect(screen.getByRole("dialog", { name: "Cuenta" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("Más opciones folds the split (#171, S3)", () => {
  it("starts folded in a personal space and reveals the split with someone when opened", async () => {
    personal(fakeApi({}).api);
    expect(more()).toHaveAccessibleName("Más opciones");
    expect(more()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Dividir con alguien" })).not.toBeInTheDocument();
    await userEvent.click(more());
    expect(more()).toHaveAccessibleName("Menos opciones");
    expect(more()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Dividir con alguien" })).toBeVisible();
    await userEvent.click(more());
    expect(screen.queryByRole("button", { name: "Dividir con alguien" })).not.toBeInTheDocument();
  });

  it("keeps who paid on screen, folds only the division of a shared expense, and keeps Guardar last", async () => {
    household(fakeApi({}).api);
    expect(more()).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Pagas tú/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /División/ })).not.toBeInTheDocument();
    await userEvent.click(more());
    expect(screen.getByRole("button", { name: /Pagas tú/ })).toBeVisible();
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
    await userEvent.click(screen.getByRole("button", { name: /Categoría/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Groceries" }));
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
    await userEvent.click(screen.getByRole("button", { name: /Categoría/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Groceries" }));
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
