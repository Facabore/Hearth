"use client";

import type { Problem } from "../api/problem";
import { useProblemMessage } from "../api/use-problem-message";
import { Icon } from "../atoms/icon";

/** A failed call, announced in the person's language with the reference to quote when there is one. */
export function ProblemNotice({ problem }: { readonly problem: Problem }) {
  const { message, reference } = useProblemMessage()(problem);
  return (
    <div role="alert" className="flex gap-2 rounded-xl border border-danger p-3 text-sm text-danger">
      <Icon name="alert" size={18} />
      <div>
        <p>{message}</p>
        {reference ? <p className="text-muted">{reference}</p> : null}
      </div>
    </div>
  );
}
