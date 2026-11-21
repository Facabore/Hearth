"use client";

import { useTranslations } from "next-intl";
import { useRef, type PointerEvent } from "react";

/** How far down, in px, a drag has to carry the sheet to close it; a shorter one springs back. */
const CLOSE_DISTANCE = 96;
/** A flick at least this fast, in px per ms, closes the sheet however short it was. */
const CLOSE_SPEED = 0.5;
/** A movement shorter than this is a tap, not a drag. */
const TAP_SLOP = 6;

interface Drag {
  readonly pointerId: number;
  readonly startY: number;
  readonly startedAt: number;
  dy: number;
}

/** The sheet the handle moves: a dialog's, or the record form's own sheet (P348), which `data-sheet` marks too. */
const sheetOf = (element: HTMLElement) => element.closest<HTMLElement>('[role="dialog"], [data-sheet]');

const place = (sheet: HTMLElement | null, dy: number, settle: boolean) => {
  if (!sheet) return;
  sheet.style.transition = settle ? "transform 200ms ease-out" : "none";
  sheet.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
};

/**
 * A bottom sheet's drag down to close (P348: shared by `SheetGrabber` and the record form's handle). `handlers` go on
 * the handle; `dragged()` says, in its click handler, that the click ended a drag rather than a tap, so the drag already
 * closed the sheet or sprang it back, and forgets it.
 */
export function useSheetDrag(onClose: () => void) {
  const drag = useRef<Drag | null>(null);
  const wasDragged = useRef(false);

  const start = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startedAt: performance.now(), dy: 0 };
    wasDragged.current = false;
  };
  const follow = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.dy = Math.max(0, event.clientY - current.startY);
    if (current.dy > TAP_SLOP) wasDragged.current = true;
    if (wasDragged.current) place(sheetOf(event.currentTarget), current.dy, false);
  };
  const end = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!wasDragged.current) return;
    // Only the click this gesture ends with is not a tap; a touch drag often ends with none, and a later activation (a
    // screen reader's double tap sends a click alone) must still close.
    setTimeout(() => {
      wasDragged.current = false;
    }, 0);
    const sheet = sheetOf(event.currentTarget);
    const speed = current.dy / Math.max(1, performance.now() - current.startedAt);
    if (current.dy < CLOSE_DISTANCE && speed < CLOSE_SPEED) {
      place(sheet, 0, true);
      return;
    }
    onClose();
    // A sheet that stays open (the record form's new category goes back to the picker instead) springs back.
    setTimeout(() => {
      if (sheet?.isConnected && sheet.dataset["state"] !== "closed") place(sheet, 0, true);
    }, 0);
  };
  const cancel = (event: PointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    wasDragged.current = false;
    place(sheetOf(event.currentTarget), 0, true);
  };

  const dragged = (): boolean => {
    if (!wasDragged.current) return false;
    wasDragged.current = false;
    return true;
  };
  return {
    handlers: { onPointerDown: start, onPointerMove: follow, onPointerUp: end, onPointerCancel: cancel },
    dragged,
  };
}

/**
 * The drag handle at the top of a bottom sheet. A tap closes the sheet, and so does a drag down past a short distance or
 * a quick flick; a shorter drag springs back. It is 44 px tall and reaches 11 px above the sheet's edge, over the scrim
 * that closes it anyway, so the handle stays 16 px from the edge with the title 12 px below it, as `SheetPanel`'s boards
 * draw them. `onClose` decides what closing means: the record form's new category goes back to the picker instead. Out of the tab order (Escape and the close
 * button serve the keyboard), it stays a named button that a touch screen reader reaches. Hidden from 1024 px, where
 * the sheet is a centered panel.
 */
export function SheetGrabber({ onClose }: { readonly onClose: () => void }) {
  const t = useTranslations("common");
  const { handlers, dragged } = useSheetDrag(onClose);

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={t("closeSheet")}
      data-sheet-grabber=""
      // Sheets pad their top by 16 px: the strip runs from 11 px above the edge to 33 px below, so the handle sits 16 px
      // from the edge and what follows starts 12 px below it.
      className="-mt-[27px] flex h-11 w-full shrink-0 touch-none items-start justify-center pt-[27px] lg:hidden"
      onClick={() => {
        // The click that ends a drag is not a tap: the drag already closed the sheet or sprang it back.
        if (!dragged()) onClose();
      }}
      {...handlers}
    >
      <span className="h-[5px] w-10 rounded-full bg-track" />
    </button>
  );
}
