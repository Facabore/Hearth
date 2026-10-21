"use client";

import { useTranslations } from "next-intl";
import { Dialog } from "radix-ui";
import type { ReactNode } from "react";
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
}

/** A bottom sheet under 1024 px, a centered panel above; Escape and the scrim close it, focus returns to the trigger. */
export function SheetPanel({ open, onOpenChange, title, description, children, footer }: SheetProps) {
  const t = useTranslations("common");
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-scrim" />
        <Dialog.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          className="fixed inset-x-0 bottom-0 flex max-h-[90dvh] flex-col rounded-t-[20px] bg-surface p-4 lg:inset-auto lg:top-1/2 lg:left-1/2 lg:w-full lg:max-w-[480px] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-[20px]"
        >
          <div aria-hidden="true" className="mx-auto mb-3 h-[5px] w-10 rounded-full bg-track lg:hidden" />
          <div className="flex items-center justify-between gap-2">
            <Dialog.Title className="text-lg font-semibold text-ink">{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost">
                <Icon name="close" />
                <VisuallyHidden>{t("close")}</VisuallyHidden>
              </Button>
            </Dialog.Close>
          </div>
          {description ? (
            <Dialog.Description className="text-sm text-muted">{description}</Dialog.Description>
          ) : null}
          <div className="mt-2 overflow-y-auto">{children}</div>
          {footer ? <div className="mt-4">{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
