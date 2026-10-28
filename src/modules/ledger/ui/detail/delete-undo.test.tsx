import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, rowContext, transactionDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { TransactionDto } from "@/shared/ui/api/dto";
import { ToastProvider } from "@/shared/ui/molecules/toast-provider";
import { writeTrail } from "@/shared/ui/navigation/history";
import type { TransactionDetail } from "./transaction-detail";
import { TransactionSheet } from "./transaction-sheet";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() },
  /** What the router does to the page: the sheet is gone once the address no longer has `tx`. */
  leave: { now: (): void => undefined },
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
const { router, leave } = mocks;
beforeEach(() => {
  vi.clearAllMocks();
  router.replace.mockImplementation(() => act(() => leave.now()));
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});

const ORIGIN = "/spaces/s-1/transactions?period=2026-10";
const DELETE = "DELETE /api/v1/spaces/{spaceId}/transactions/{transactionId}";
const RESTORE = "POST /api/v1/spaces/{spaceId}/transactions/{transactionId}/restore";
const noContent = () => new Response(null, { status: 204 });
const restored = () => jsonResponse(transactionDto({ id: "t-1", version: 3 }));

const market = transactionDto({
  id: "t-1",
  type: "EXPENSE",
  description: "Market",
  amount: cop(85_000),
  payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(85_000) }],
});
const detailOf = (tx: TransactionDto): TransactionDetail => ({
  tx,
  problem: null,
  members: [],
  viewer: { userId: "u-ana", role: "OWNER", memberId: null },
  ownAccountNames: {},
});

/** The sheet over its list: replacing the address removes it, as it does in the app (an open modal hides the toast). */
function Page({ tx, api }: { readonly tx: TransactionDto; readonly api: Api }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    leave.now = () => setOpen(false);
  }, []);
  return open ? (
    <TransactionSheet spaceId="s-1" detail={detailOf(tx)} context={rowContext} origin={ORIGIN} api={api} />
  ) : null;
}
const renderSheet = (api: Api, tx: TransactionDto = market, locale: "es" | "en" = "es") =>
  renderWithIntl(
    <ToastProvider>
      <Page tx={tx} api={api} />
    </ToastProvider>,
    { locale },
  );
const methods = (requests: Request[]) => requests.map((r) => `${r.method} ${new URL(r.url).pathname}`);
const status = () => screen.getByRole("status");
const said = (text: string) => waitFor(() => expect(status()).toHaveTextContent(text));
const deleteIt = () => userEvent.click(screen.getByRole("button", { name: "Eliminar" }));

describe("delete with undo (ruling P194)", () => {
  it("deletes at once, closes to the list, refreshes, and offers Deshacer in a status toast", async () => {
    const { api, requests } = fakeApi({ [DELETE]: noContent });
    renderSheet(api);
    await deleteIt();
    await said("Gasto eliminado");
    expect(methods(requests)).toEqual(["DELETE /api/v1/spaces/s-1/transactions/t-1"]);
    expect(router.replace).toHaveBeenCalledWith(ORIGIN, { scroll: false });
    expect(router.back).not.toHaveBeenCalled();
    expect(router.refresh).toHaveBeenCalled();
    expect(within(status()).getByRole("button", { name: "Deshacer" })).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it.each([
    ["EXPENSE", "Gasto eliminado", "Gasto restaurado"],
    ["INCOME", "Ingreso eliminado", "Ingreso restaurado"],
    ["TRANSFER", "Transferencia eliminada", "Transferencia restaurada"],
    ["SETTLEMENT", "Pago eliminado", "Pago restaurado"],
  ] as const)("names a %s in the toasts of the delete and of the undo", async (type, deleted, back) => {
    const { api } = fakeApi({ [DELETE]: noContent, [RESTORE]: restored });
    const tx = transactionDto({ id: "t-1", type, description: "Item", amount: cop(1_000) });
    renderSheet(api, tx, "es");
    await deleteIt();
    await said(deleted);
    await userEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    await said(back);
  });

  it("speaks English with the same flow", async () => {
    const { api } = fakeApi({ [DELETE]: noContent, [RESTORE]: restored });
    renderSheet(api, market, "en");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await said("Expense deleted");
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    await said("Expense restored");
  });

  it("restores once on Deshacer, refreshes again and says so", async () => {
    const { api, requests } = fakeApi({ [DELETE]: noContent, [RESTORE]: restored });
    renderSheet(api);
    await deleteIt();
    await said("Gasto eliminado");
    await userEvent.dblClick(screen.getByRole("button", { name: "Deshacer" }));
    await said("Gasto restaurado");
    expect(methods(requests)).toEqual([
      "DELETE /api/v1/spaces/s-1/transactions/t-1",
      "POST /api/v1/spaces/s-1/transactions/t-1/restore",
    ]);
    expect(router.refresh).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "Deshacer" })).not.toBeInTheDocument();
  });

  it("keeps the sheet open with the problem when the delete is refused", async () => {
    const { api } = fakeApi({ [DELETE]: () => problemResponse(409, "PeriodClosed") });
    renderSheet(api);
    await deleteIt();
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "Ese periodo está cerrado. Elige una fecha de un periodo abierto.",
      ),
    );
    expect(status()).toBeEmptyDOMElement();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    // The person can still try again, and a second try clears the first problem while it runs.
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeEnabled();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("shows the problem above the buttons of the footer", async () => {
    const { api } = fakeApi({ [DELETE]: () => problemResponse(403, "InsufficientRole") });
    renderSheet(api);
    await deleteIt();
    const dialog = await screen.findByRole("dialog");
    const alert = await within(dialog).findByRole("alert");
    const button = within(dialog).getByRole("button", { name: "Eliminar" });
    expect(alert).toHaveTextContent("No tienes permiso para hacer esto en este espacio.");
    expect(alert.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says Algo salió mal when the delete never reaches the server", async () => {
    const { api } = fakeApi({
      [DELETE]: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    renderSheet(api);
    await deleteIt();
    expect(await within(await screen.findByRole("dialog")).findByRole("alert")).toHaveTextContent(
      "Algo salió mal. Intenta de nuevo.",
    );
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeEnabled();
  });

  it("says in an alert when the undo fails", async () => {
    const { api } = fakeApi({ [DELETE]: noContent, [RESTORE]: () => problemResponse(409, "PeriodClosed") });
    renderSheet(api);
    await deleteIt();
    await said("Gasto eliminado");
    await userEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "No se pudo deshacer: Ese periodo está cerrado. Elige una fecha de un periodo abierto.",
      ),
    );
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("says in an alert when the undo never reaches the server", async () => {
    const { api } = fakeApi({
      [DELETE]: noContent,
      [RESTORE]: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    renderSheet(api);
    await deleteIt();
    await said("Gasto eliminado");
    await userEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("No se pudo deshacer: Algo salió mal."),
    );
  });

  it("sends one DELETE for a double click", async () => {
    let finish: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (finish = resolve));
    const { api, requests } = fakeApi({
      [DELETE]: async () => {
        await gate;
        return noContent();
      },
    });
    renderSheet(api);
    const button = screen.getByRole("button", { name: "Eliminar" });
    await userEvent.dblClick(button);
    expect(button).toBeDisabled();
    finish();
    await said("Gasto eliminado");
    expect(methods(requests)).toEqual(["DELETE /api/v1/spaces/s-1/transactions/t-1"]);
    expect(router.replace).toHaveBeenCalledTimes(1);
  });

  it("goes back to the list it was opened from, adding no entry, and refreshes once the list is back", async () => {
    const here = "/spaces/s-1/transactions?tx=t-1";
    window.history.replaceState({}, "", here);
    writeTrail({ urls: [ORIGIN, here], pos: 1 });
    const { api } = fakeApi({ [DELETE]: noContent });
    renderSheet(api);
    await deleteIt();
    await said("Gasto eliminado");
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    // The router has not traversed yet: refreshing now would reload the sheet's address, not the list.
    expect(router.refresh).not.toHaveBeenCalled();
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});
