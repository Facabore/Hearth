import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntlWrapper } from "../../../../../tests/support/ui/render";
import { cop, transactionDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import type { ToastInput } from "@/shared/ui/molecules/toast";
import { useDeleteWithUndo } from "./use-delete-with-undo";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() },
  shown: [] as ToastInput[],
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
// The toast's own button closes it after the first tap; here the action is called twice to pin the hook's own guard.
vi.mock("@/shared/ui/molecules/toast", () => ({
  useToast: () => ({ show: (toast: ToastInput) => mocks.shown.push(toast), dismiss: vi.fn() }),
}));
const { router, shown } = mocks;
beforeEach(() => {
  vi.clearAllMocks();
  shown.length = 0;
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});

const tx = transactionDto({ id: "t-1", type: "EXPENSE", amount: cop(1_000) });
const ORIGIN = "/spaces/s-1/transactions";

describe("useDeleteWithUndo (ruling P194)", () => {
  it("runs one restore however many times the toast's action is called", async () => {
    let restores = 0;
    const { api } = fakeApi({
      "DELETE /api/v1/spaces/{spaceId}/transactions/{transactionId}": () =>
        new Response(null, { status: 204 }),
      "POST /api/v1/spaces/{spaceId}/transactions/{transactionId}/restore": () => {
        restores += 1;
        return jsonResponse(transactionDto({ id: "t-1", version: 3 }));
      },
    });
    const { result } = renderHook(() => useDeleteWithUndo({ api, spaceId: "s-1", tx, origin: ORIGIN }), {
      wrapper: IntlWrapper("es"),
    });
    await act(() => result.current.remove());
    const action = shown[0]!.action!;
    await act(async () => {
      action.onAction();
      action.onAction();
    });
    expect(restores).toBe(1);
    expect(shown.map((toast) => toast.message)).toEqual(["Gasto eliminado", "Gasto restaurado"]);
  });

  it("keeps the toast silent when the delete is refused, and reports the problem", async () => {
    const { api } = fakeApi({
      "DELETE /api/v1/spaces/{spaceId}/transactions/{transactionId}": () =>
        problemResponse(403, "InsufficientRole"),
    });
    const { result } = renderHook(() => useDeleteWithUndo({ api, spaceId: "s-1", tx, origin: ORIGIN }), {
      wrapper: IntlWrapper("es"),
    });
    await act(() => result.current.remove());
    expect(shown).toEqual([]);
    expect(result.current.problem?.code).toBe("InsufficientRole");
    expect(result.current.pending).toBe(false);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("sends one DELETE while one is in flight, and a new try clears the previous problem", async () => {
    let finish: () => void = () => undefined;
    let deletes = 0;
    const { api } = fakeApi({
      "DELETE /api/v1/spaces/{spaceId}/transactions/{transactionId}": async () => {
        deletes += 1;
        if (deletes === 1) return problemResponse(409, "PeriodClosed");
        await new Promise<void>((resolve) => (finish = resolve));
        return new Response(null, { status: 204 });
      },
    });
    const { result } = renderHook(() => useDeleteWithUndo({ api, spaceId: "s-1", tx, origin: ORIGIN }), {
      wrapper: IntlWrapper("es"),
    });
    await act(() => result.current.remove());
    expect(result.current.problem?.code).toBe("PeriodClosed");

    let second: Promise<void> = Promise.resolve();
    await act(async () => {
      second = result.current.remove();
      await Promise.resolve();
    });
    expect(result.current.pending).toBe(true);
    expect(result.current.problem, "a new try starts without the old problem").toBeNull();
    await act(() => result.current.remove());
    expect(deletes, "a third call while the second runs sends nothing").toBe(2);
    await act(async () => {
      finish();
      await second;
    });
    expect(shown).toHaveLength(1);
  });
});
