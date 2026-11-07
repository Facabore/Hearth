import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import type { HoldNavigation } from "@/shared/ui/navigation/hold-navigation";

const indexOf = (location: { state: unknown }): number =>
  Number((location.state as Record<string, unknown> | null)?.["__TSR_index"] ?? 0);

/**
 * Issue #215 (F9): how a form holds a navigation away while it has something typed: Volver, the system back and another
 * screen alike wait on the form's question. A reload or a closed tab is left to the browser: its own prompt cannot name
 * what is lost. A replace never asks: a guard's redirect (an expired session) is not the person leaving. A move to
 * the same address never asks either: it is a sheet's entry of the history closing (ruling P307). It blocks through
 * the router's history itself, whose code every screen already loads, rather than `useBlocker`, which would add to the
 * app's first script.
 *
 * Ruling P307: Back and Forward have already moved the address when they are heard, so the address goes back to the
 * form at once and, once the person chooses to leave, makes the same move again.
 */
export function useHoldNavigation(): HoldNavigation {
  const { history } = useRouter();
  return useCallback(
    (stay) =>
      history.block({
        enableBeforeUnload: false,
        blockerFn: ({ action, currentLocation, nextLocation }) => {
          if (action === "REPLACE" || nextLocation.href === currentLocation.href) return false;
          if (action === "PUSH") return stay();
          const delta = indexOf(nextLocation) - indexOf(currentLocation);
          void stay().then((staying) => {
            if (!staying) history.go(delta, { ignoreBlocker: true });
          });
          return true;
        },
      }),
    [history],
  );
}
