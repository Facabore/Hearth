import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { RecordSheet } from "./record-sheet";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

const BACK = "/spaces/sp-personal";

const open = () => {
  renderWithIntl(
    <RecordSheet backHref={BACK} title="Registrar gasto">
      <p>Monto</p>
    </RecordSheet>,
  );
  const sheet = screen.getByRole("region", { name: "Registrar gasto" });
  return { sheet, handle: screen.getByRole("link", { name: "Volver" }) };
};

/** A drag on the handle, `distance` px down in `duration` ms, ending with the click a mouse sends. */
const drag = (handle: HTMLElement, distance: number, duration: number) => {
  vi.useFakeTimers({ toFake: ["performance"] });
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 100 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 100 + distance / 2 });
  vi.advanceTimersByTime(duration);
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 100 + distance });
  fireEvent.pointerUp(handle, { pointerId: 1, clientY: 100 + distance });
  fireEvent.click(handle);
};

describe("Registrar's handle closes it with a drag down, as every sheet's does (P348, #356)", () => {
  it("carries the form with the finger while it drags", () => {
    const { sheet, handle } = open();
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 160 });

    expect(sheet.style.transform).toBe("translateY(60px)");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("closes on a drag down past the closing distance, back to where it was opened from", () => {
    const { handle } = open();
    drag(handle, 140, 1000);

    expect(router.push).toHaveBeenCalledExactlyOnceWith(BACK);
  });

  it("closes on a quick flick, however short", () => {
    const { handle } = open();
    drag(handle, 40, 50);

    expect(router.push).toHaveBeenCalledExactlyOnceWith(BACK);
  });

  it("springs back on a slow, short drag and stays open", () => {
    const { sheet, handle } = open();
    drag(handle, 40, 1000);

    expect(router.push).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe("");
  });

  it("stays a link a tap follows, in the tab order", async () => {
    const { handle } = open();
    expect(handle).toHaveAttribute("href", BACK);
    expect(handle).not.toHaveAttribute("tabindex", "-1");
    // As every sheet's handle, it spans the top of the form, so a swipe needs no aim.
    expect(handle).toHaveClass("touch-none", "w-full", "h-11");
    // A browser drags a link natively unless told not to, and its drag cancels the pointer the handle follows.
    expect(handle).toHaveAttribute("draggable", "false");
  });
});

describe("Registrar's scrim", () => {
  it("still closes it on a tap", async () => {
    open();
    await userEvent.click(screen.getByTestId("record-scrim"));

    expect(router.push).toHaveBeenCalledExactlyOnceWith(BACK);
  });
});
