"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

/** U5: how long a stored change says so, on Settings and wherever a field saves itself (#170). */
export const SAVED_MS = 2000;

/**
 * Which field was stored last, for about two seconds. Saving the same field again starts the two seconds again, and
 * leaving the screen cancels the timer.
 */
export const useSavedFlash = <F extends string>() => {
  const [saved, setSaved] = useState<F | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flash = useCallback((field: F) => {
    clearTimeout(timer.current);
    setSaved(field);
    timer.current = setTimeout(() => setSaved(null), SAVED_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { saved, flash };
};

/**
 * U5: "Guardado" beside a field, a status the screen reader announces. It is positioned out of the flow, so showing and
 * hiding it never moves the field or its Predeterminado/Restablecer. The field's wrapper is `relative`; `className`
 * says where in it.
 */
export function SavedFlash({ show, className }: { readonly show: boolean; readonly className: string }) {
  const t = useTranslations("common");
  return show ? (
    <span
      role="status"
      className={`pointer-events-none absolute right-0 text-sm font-medium text-accent ${className}`}
    >
      {t("saved")}
    </span>
  ) : null;
}
