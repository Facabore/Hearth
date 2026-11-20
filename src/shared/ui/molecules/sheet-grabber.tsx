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

const sheetOf = (element: HTMLElement) => element.closest<HTMLElement>('[role="dialog"]');

const place = (sheet: HTMLElement | null, dy: number, settle: boolean) => {
  if (!sheet) return;
  sheet.style.transition = settle ? "transform 200ms ease-out" : "none";
  sheet.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
};

/**
 * The drag handle at the top of a bottom sheet. A tap closes the sheet, and so does a drag down past a short distance or
 * a quick flick; a shorter drag springs back. It is 44 px tall and reaches 11 px above the sheet's edge, over the scrim
 * that closes it anyway, so the handle and the title stay where the boards draw them. Out of the tab order (Escape and the close
 * button serve the keyboard), it stays a named button that a touch screen reader reaches. Hidden from 1024 px, where
 * the sheet is a centered panel.
 */
export function SheetGrabber({ onClose }: { readonly onClose: () => void }) {
  const t = useTranslations("common");
  const drag = useRef<Drag | null>(null);
  const dragged = useRef(false);

  const start = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startedAt: performance.now(), dy: 0 };
    dragged.current = false;
  };
  const follow = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.dy = Math.max(0, event.clientY - current.startY);
    if (current.dy > TAP_SLOP) dragged.current = true;
    if (dragged.current) place(sheetOf(event.currentTarget), current.dy, false);
  };
  const end = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    if (!dragged.current) return;
    const speed = current.dy / Math.max(1, performance.now() - current.startedAt);
    if (current.dy >= CLOSE_DISTANCE || speed >= CLOSE_SPEED) onClose();
    else place(sheetOf(event.currentTarget), 0, true);
  };
  const cancel = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    place(sheetOf(event.currentTarget), 0, true);
  };

  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={t("closeSheet")}
      data-sheet-grabber=""
      // Sheets pad their top by 16 px: the strip runs from 11 px above the edge to 33 px below, and the handle keeps
      // its 16 px from the edge and its 12 px above the title.
      className="-mt-[27px] flex h-11 w-full shrink-0 touch-none items-start justify-center pt-[27px] lg:hidden"
      onClick={() => {
        // The click that ends a drag is not a tap: the drag already closed the sheet or sprang it back.
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        onClose();
      }}
      onPointerDown={start}
      onPointerMove={follow}
      onPointerUp={end}
      onPointerCancel={cancel}
    >
      <span className="h-[5px] w-10 rounded-full bg-track" />
    </button>
  );
}
