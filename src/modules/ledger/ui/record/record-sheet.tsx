"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, type ReactNode } from "react";
import { goBack } from "@/shared/ui/navigation/history";

/**
 * Ruling P291 (board B1 · 01): the record form as a bottom sheet over a scrim, with a drag handle and no shell header
 * or bottom bar (the route is a stacked screen). It keeps its own URL, so a deep link opens it. The handle is the way
 * back, a real link to the screen it was opened from; the scrim and Escape close it the same way, unless a sheet of
 * the form's own is open over it.
 */
export function RecordSheet({
  backHref,
  title,
  children,
}: {
  readonly backHref: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const t = useTranslations("common");
  const router = useRouter();
  // As the handle does: back to where the person was, or to `backHref` when this tab has no such step.
  const close = useCallback(() => {
    let returned = false;
    goBack({
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: () => {
        returned = true;
      },
    });
    if (!returned) router.push(backHref);
  }, [router, backHref]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector("[role='dialog']"))
        close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);
  return (
    <>
      <div
        aria-hidden="true"
        data-testid="record-scrim"
        onClick={close}
        className="fixed inset-0 z-40 bg-scrim"
      />
      <section
        aria-labelledby="record-title"
        className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[560px] flex-col overflow-y-auto overscroll-contain rounded-t-[20px] bg-surface px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      >
        <Link
          href={backHref}
          onClick={goBack}
          aria-label={t("back")}
          className="mx-auto -mb-3 flex h-11 w-16 shrink-0 justify-center pt-2"
        >
          <span aria-hidden="true" className="h-[5px] w-10 rounded-full bg-track" />
        </Link>
        <h1 id="record-title" className="sr-only">
          {title}
        </h1>
        {children}
      </section>
    </>
  );
}
