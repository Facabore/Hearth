"use client";

import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { closeSheetEntry, openSheetEntry, sheetDepth } from "../navigation/sheet-history";
import { Button } from "../atoms/button";
import { Icon } from "../atoms/icon";
import { VisuallyHidden } from "../atoms/visually-hidden";

export interface SheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  /**
   * P292: false where the board draws only the drag handle (the space switcher, the profile, Nueva cuenta). The button
   * then shows only from 1024 px, where the centered panel has no handle; Escape and the scrim close it everywhere.
   */
  readonly closeButton?: boolean;
  /** What the board draws before the title, such as the person's avatar or the category's icon (P292). */
  readonly leading?: ReactNode;
  /**
   * Ruling P307: false for a sheet that has an address of its own (`?tx=`, `/accounts/new`) or that a navigation opens
   * (the discard question). Any other sheet takes an entry of the browser's history while open, so Back closes it.
   */
  readonly historyEntry?: boolean;
}

/** Ruling P307: the sheet's entry of the browser's history while it is open; Back to the entry below closes it. */
function useSheetEntry(onOpenChange: (open: boolean) => void, on: boolean) {
  const close = useRef(onOpenChange);
  useEffect(() => {
    close.current = onOpenChange;
  });
  const kept = useRef(0);
  // A layout effect: the entry goes back in the same commit that removes the sheet, before anyone sees it gone and
  // starts another navigation that the late Back would cut short.
  useLayoutEffect(() => {
    if (!on) return undefined;
    const depth = openSheetEntry(kept.current);
    kept.current = depth;
    if (depth === 0) return undefined;
    const onPop = () => {
      if (sheetDepth() < depth) close.current(false);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      closeSheetEntry(depth);
    };
  }, [on]);
}

/**
 * A bottom sheet under 1024 px, a centered panel above; Escape and the scrim close it, focus returns to the trigger.
 * It paints above the fixed bottom navigation (z-10); only its body scrolls and the page behind stays put.
 */
export function SheetPanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  closeButton = true,
  leading,
  historyEntry = true,
}: SheetProps) {
  const t = useTranslations("common");
  useSheetEntry(onOpenChange, open && historyEntry);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <Dialog.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          // Ruling P301: while it is open the toast shows at the top of the screen.
          data-sheet=""
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-[20px] bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:inset-auto lg:top-1/2 lg:left-1/2 lg:w-full lg:max-w-[480px] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-[20px]"
        >
          <div aria-hidden="true" className="mx-auto mb-3 h-[5px] w-10 rounded-full bg-track lg:hidden" />
          <div className="flex items-center justify-between gap-2">
            {leading ? <div className="shrink-0">{leading}</div> : null}
            <Dialog.Title className="min-w-0 flex-1 text-lg font-semibold [overflow-wrap:anywhere] text-ink">
              {title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" className={closeButton ? undefined : "max-lg:hidden"}>
                <Icon name="close" />
                <VisuallyHidden>{t("close")}</VisuallyHidden>
              </Button>
            </Dialog.Close>
          </div>
          {description ? (
            <Dialog.Description className="text-sm [overflow-wrap:anywhere] text-muted">
              {description}
            </Dialog.Description>
          ) : null}
          {/* Ruling P320: the body reaches the sheet's edges and pads its content back, so its scrollbar runs along the
              sheet's edge instead of over the fields' right border; the content stays lined up with the title. */}
          <div className="-mx-4 mt-2 min-h-0 overflow-y-auto overscroll-contain px-4">{children}</div>
          {footer ? <div className="mt-3">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
