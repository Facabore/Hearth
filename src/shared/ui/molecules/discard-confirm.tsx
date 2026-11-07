"use client";

import { Button } from "../atoms/button";
import { Sheet } from "./sheet";

/**
 * Issue #215, ruling P307: "¿Descartar …?" before a form drops what was typed. `confirm` leaves; `keep`, Escape or
 * closing the sheet stays. A navigation opens it, so it takes no entry of the browser's history of its own.
 */
export function DiscardConfirm({
  title,
  confirm,
  keep,
  answer,
}: {
  readonly title: string;
  readonly confirm: string;
  readonly keep: string;
  /** true leaves, false stays. */
  readonly answer: (leave: boolean) => void;
}) {
  return (
    <Sheet
      open
      historyEntry={false}
      // The sheet only ever closes itself; it is opened by a navigation, never by a trigger.
      onOpenChange={() => answer(false)}
      title={title}
      footer={
        <div className="flex flex-col gap-3">
          <Button variant="danger" size="lg" onClick={() => answer(true)}>
            {confirm}
          </Button>
          <Button variant="secondary" size="lg" onClick={() => answer(false)}>
            {keep}
          </Button>
        </div>
      }
    >
      {null}
    </Sheet>
  );
}
