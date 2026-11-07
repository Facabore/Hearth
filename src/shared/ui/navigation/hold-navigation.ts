import { useCallback, useEffect, useState } from "react";

/**
 * Issue #215 (F9 of the UX audit): holds every navigation away from a form (Volver, the system back, another screen)
 * while it has something typed. The app's router gives it; `stay` is asked before leaving, and the navigation goes on
 * only once it resolves false. It returns the release, called once the form no longer needs holding.
 */
export type HoldNavigation = (stay: () => Promise<boolean>) => () => void;

/**
 * Ruling P307: a form's question before what was typed is dropped. While `held`, every navigation away waits on it
 * (through `holdNavigation`); `ask` puts the same question for a way out that is not a navigation, such as closing a
 * sheet. `answer` settles the question on screen (true leaves) and is null while none is asked.
 */
export function useLeaveQuestion(held: boolean, holdNavigation: HoldNavigation | undefined) {
  const [answer, setAnswer] = useState<((leave: boolean) => void) | null>(null);
  const ask = useCallback(
    () =>
      new Promise<boolean>((resolve) =>
        setAnswer(() => (leave: boolean) => {
          setAnswer(null);
          resolve(leave);
        }),
      ),
    [],
  );
  useEffect(
    () => (held && holdNavigation ? holdNavigation(async () => !(await ask())) : undefined),
    [held, holdNavigation, ask],
  );
  return { answer, ask };
}
