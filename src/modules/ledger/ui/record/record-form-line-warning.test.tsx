import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import {
  accountDto,
  categoryDto,
  groupDto,
  normalized,
  spaceDto,
  transactionDto,
} from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { e7Dashboard } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import es from "@/i18n/messages/es.json";
import type { Api } from "@/shared/ui/api/client";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { lineWatchOf, type LineWatch } from "./line-watch";
import { RecordForm } from "./record-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  // 31 October, 23:30 in Bogotá: today is in October's period.
  vi.setSystemTime(new Date("2026-11-01T04:30:00Z"));
});
afterEach(() => vi.useRealTimers());

const groceries = categoryDto({
  id: "c-groceries",
  name: "Groceries",
  subcategories: [
    categoryDto({ id: "c-veg", name: "Vegetables", parentCategoryId: "c-groceries" }),
    categoryDto({ id: "c-meat", name: "Meat", parentCategoryId: "c-groceries" }),
  ],
});
const groups = [groupDto({ id: "g-food", name: "Food", categories: [groceries] })];
const accounts = [
  accountDto({ id: "a-bank", name: "Bancolombia", type: "BANK" }),
  accountDto({ id: "a-visa", name: "Visa", type: "CREDIT_CARD", icon: "card" }),
];
const recorded = () => jsonResponse(transactionDto({ id: "t-new" }), 201);
const OCTOBER = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };
/** Home: 1,470,000 COP planned, 1,300,000 spent and 170,000 available, fed by Groceries. */
const watch = lineWatchOf({
  ...e7Dashboard({ period: OCTOBER }),
  categoryLines: [{ categoryId: "c-groceries", lineId: "l-home" }],
});
const form = (api: Api, lineWatch: LineWatch | null) =>
  renderWithIntl(
    <RecordForm
      space={spaceDto()}
      accounts={accounts}
      groups={groups}
      formats={BUILT_IN_FORMATS}
      initialKind="EXPENSE"
      initialNow="2026-11-01T04:30:00.000Z"
      timeZone="America/Bogota"
      api={api}
      lineWatch={lineWatch}
    />,
  );

const SAVE = es.ledger.form.save.EXPENSE;
const CONFIRM_TITLE = "¿Guardar de todos modos?";
const noteText = () => normalized(document.getElementById("record-line-warning")?.textContent);
const typeExpense = async (amount: string) => {
  await userEvent.type(screen.getByLabelText("Monto"), amount);
  await userEvent.click(screen.getByRole("button", { name: /Categoría/ }));
  await userEvent.click(screen.getByRole("radio", { name: "Groceries" }));
  await userEvent.click(screen.getByRole("button", { name: "Usar Groceries" }));
};
const expenses = (requests: Request[]) => requests.filter((r) => r.url.endsWith("/expenses"));

describe("the record form warns before a line goes past 90 % (#142, rulings P235–P237 of M6c)", () => {
  it("notes 80 % in the neutral tone and saves at once", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": recorded });
    form(api, watch);
    await typeExpense("20000");
    expect(noteText()).toBe("Con este gasto, Home quedaría en 89,79 % de lo planeado.");
    expect(document.getElementById("record-line-warning")).toHaveAttribute("data-level", "NEAR");
    expect(screen.getByRole("button", { name: SAVE })).toHaveAttribute(
      "aria-describedby",
      "record-line-warning",
    );
    await userEvent.click(screen.getByRole("button", { name: SAVE }));
    await waitFor(() => expect(expenses(requests)).toHaveLength(1));
    expect(screen.queryByRole("heading", { name: CONFIRM_TITLE })).toBeNull();
  });

  it("asks first above 90 %, and saves once on Guardar de todos modos", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": recorded });
    const { container } = form(api, watch);
    await typeExpense("85000");
    await userEvent.click(screen.getByRole("button", { name: SAVE }));
    expect(screen.getByRole("heading", { name: CONFIRM_TITLE })).toHaveFocus();
    expect(normalized(screen.getByRole("region", { name: CONFIRM_TITLE }).textContent)).toContain(
      "Con este gasto, Home quedaría en 94,21 % de lo planeado y le quedarían $ 85.000.",
    );
    expect(screen.queryByRole("button", { name: SAVE })).toBeNull();
    expect(expenses(requests)).toHaveLength(0);
    expect(await axeViolations(container)).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Guardar de todos modos" }));
    await waitFor(() => expect(expenses(requests)).toHaveLength(1));
  });

  it("states the overage as an amount, and Revisar el monto goes back to the amount without saving", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": recorded });
    form(api, watch);
    await typeExpense("212300");
    await userEvent.click(screen.getByRole("button", { name: SAVE }));
    const panel = normalized(screen.getByRole("region", { name: CONFIRM_TITLE }).textContent);
    expect(panel).toContain("Con este gasto te pasarías por $ 42.300 en Home.");
    // Ruling P244: an overage is an amount in words, never a percentage above 100 %.
    expect(panel).not.toMatch(/%/);
    await userEvent.click(screen.getByRole("button", { name: "Revisar el monto" }));
    expect(screen.getByLabelText("Monto")).toHaveFocus();
    expect(screen.queryByRole("heading", { name: CONFIRM_TITLE })).toBeNull();
    expect(expenses(requests)).toHaveLength(0);
  });

  it("asks again once the amount changes after a confirmation was asked", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": recorded });
    form(api, watch);
    await typeExpense("212300");
    await userEvent.click(screen.getByRole("button", { name: SAVE }));
    await userEvent.type(screen.getByLabelText("Monto"), "0");
    expect(screen.queryByRole("heading", { name: CONFIRM_TITLE })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: SAVE }));
    expect(screen.getByRole("heading", { name: CONFIRM_TITLE })).toBeInTheDocument();
    expect(expenses(requests)).toHaveLength(0);
  });

  it("warns of nothing without a watch", async () => {
    const { api } = fakeApi({});
    form(api, null);
    await typeExpense("212300");
    expect(document.getElementById("record-line-warning")).toBeNull();
  });
});
