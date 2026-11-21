"use client";

import { useTranslations } from "next-intl";
import { useSheetDrag } from "./sheet-drag";

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
