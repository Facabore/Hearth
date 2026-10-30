import { useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import type { LeaveGuard } from "@/modules/ledger/ui";

/**
 * Issue #215 (F9): the router asks the form before any navigation away from it, Volver, the system back and another
 * screen alike, and waits on the person's answer while the form holds something typed. A reload or a closed tab is
 * left to the browser: its own prompt cannot name what is lost. A replace never asks: a saved form replaces its own
 * entry with where it lands (#172), and a guard's redirect (an expired session) is not the person leaving. It blocks
 * through the router's history itself, whose code every screen already loads, rather than `useBlocker`, which would
 * add to the app's first script.
 */
export function useLeaveGuard(): LeaveGuard {
  const { history } = useRouter();
  const dirty = useRef(false);
  // Settles the waiting navigation: true leaves, false stays.
  const [answer, setAnswer] = useState<((leave: boolean) => void) | null>(null);
  useEffect(
    () =>
      history.block({
        enableBeforeUnload: false,
        blockerFn: ({ action }) =>
          action !== "REPLACE" &&
          dirty.current &&
          new Promise<boolean>((resolve) =>
            setAnswer(() => (leave: boolean) => {
              setAnswer(null);
              resolve(!leave);
            }),
          ),
      }),
    [history],
  );
  return {
    asking: answer !== null,
    track: (next) => {
      dirty.current = next;
    },
    discard: () => answer?.(true),
    keep: () => answer?.(false),
  };
}
