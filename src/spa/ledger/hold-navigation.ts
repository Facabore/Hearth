import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import type { HoldNavigation } from "@/modules/ledger/ui";

/**
 * Issue #215 (F9): how the record form holds a navigation away while it has something typed: Volver, the system back
 * and another screen alike wait on the form's question. A reload or a closed tab is left to the browser: its own
 * prompt cannot name what is lost. A replace never asks: a saved form replaces its own entry with where it lands
 * (#172), and a guard's redirect (an expired session) is not the person leaving. It blocks through the router's history
 * itself, whose code every screen already loads, rather than `useBlocker`, which would add to the app's first script.
 */
export function useHoldNavigation(): HoldNavigation {
  const { history } = useRouter();
  return useCallback(
    (stay) =>
      history.block({
        enableBeforeUnload: false,
        blockerFn: ({ action }) => action !== "REPLACE" && stay(),
      }),
    [history],
  );
}
