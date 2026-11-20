import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { Sheet } from "./sheet";

const open = () => {
  const onOpenChange = vi.fn();
  const view = renderWithIntl(
    <Sheet open onOpenChange={onOpenChange} title="Filtros">
      <p>Período</p>
    </Sheet>,
  );
  const sheet = screen.getByRole("dialog", { name: "Filtros" });
  return {
    ...view,
    onOpenChange,
    sheet,
    grabber: within(sheet).getByRole("button", { name: "Cerrar panel" }),
  };
};

const drag = (grabber: HTMLElement, distance: number, duration: number) => {
  vi.useFakeTimers({ toFake: ["performance"] });
  fireEvent.pointerDown(grabber, { pointerId: 1, button: 0, clientY: 100 });
  fireEvent.pointerMove(grabber, { pointerId: 1, clientY: 100 + distance / 2 });
  vi.advanceTimersByTime(duration);
  fireEvent.pointerMove(grabber, { pointerId: 1, clientY: 100 + distance });
  fireEvent.pointerUp(grabber, { pointerId: 1, clientY: 100 + distance });
  fireEvent.click(grabber);
};

describe("the sheet's drag handle closes it", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is a named button, out of the tab order, that a tap closes the sheet with, and keeps axe clean", async () => {
    const { grabber, onOpenChange, baseElement } = open();
    expect(grabber).toHaveAttribute("tabindex", "-1");
    expect(grabber).toHaveClass("h-11", "lg:hidden");
    expect(await axeViolations(baseElement)).toEqual([]);
    await userEvent.click(grabber);
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("carries the sheet with the finger while it drags", () => {
    const { grabber, sheet, onOpenChange } = open();
    fireEvent.pointerDown(grabber, { pointerId: 1, button: 0, clientY: 100 });
    fireEvent.pointerMove(grabber, { pointerId: 1, clientY: 160 });
    expect(sheet.style.transform).toBe("translateY(60px)");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("closes on a drag down past the closing distance", () => {
    const { grabber, onOpenChange } = open();
    drag(grabber, 140, 1000);
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("closes on a quick flick, however short", () => {
    const { grabber, onOpenChange } = open();
    drag(grabber, 40, 50);
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("springs back on a slow, short drag and stays open", () => {
    const { grabber, sheet, onOpenChange } = open();
    drag(grabber, 40, 1000);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe("");
  });

  it("still closes on a tap after a drag that sprang back with no click, as a screen reader's activation sends", async () => {
    const { grabber, onOpenChange } = open();
    vi.useFakeTimers({ toFake: ["performance"] });
    fireEvent.pointerDown(grabber, { pointerId: 1, button: 0, clientY: 100 });
    vi.advanceTimersByTime(1000);
    fireEvent.pointerMove(grabber, { pointerId: 1, clientY: 140 });
    fireEvent.pointerUp(grabber, { pointerId: 1, clientY: 140 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(grabber);
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("springs back when the browser cancels the drag, and a later tap still closes", () => {
    const { grabber, sheet, onOpenChange } = open();
    fireEvent.pointerDown(grabber, { pointerId: 1, button: 0, clientY: 100 });
    fireEvent.pointerMove(grabber, { pointerId: 1, clientY: 150 });
    fireEvent.pointerCancel(grabber, { pointerId: 1 });
    expect(sheet.style.transform).toBe("");
    fireEvent.click(grabber);
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });
});
