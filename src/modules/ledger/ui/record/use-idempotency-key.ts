import { useCallback, useState } from "react";

/**
 * HU-E0-10, ruling P128: one Idempotency-Key per draft. The same key for every submit of an unchanged draft (a double
 * click, a retry after a network failure), a fresh one when the draft changes and after a save.
 */
export const useIdempotencyKey = (signature: string): { key: string; renew(): void } => {
  const [current, setCurrent] = useState(() => ({ signature, key: crypto.randomUUID() }));
  let { key } = current;
  if (current.signature !== signature) {
    // Adjusting state while rendering (React's documented pattern): the new draft gets its key in this same render.
    key = crypto.randomUUID();
    setCurrent({ signature, key });
  }
  const renew = useCallback(
    () => setCurrent((now) => ({ signature: now.signature, key: crypto.randomUUID() })),
    [],
  );
  return { key, renew };
};
