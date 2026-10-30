import { useTranslations } from "next-intl";
import { Button, Sheet } from "@/shared/ui";
import type { RecordKind } from "./record-request";

/**
 * Issue #215 (F9 of the UX audit): what holds the person on a form that has something typed while they leave it. The
 * app's router fills it: it asks the form before any navigation away (Volver, the system back, another screen), and
 * the form answers through the sheet below.
 */
export interface LeaveGuard {
  /** A navigation away is waiting on the person's answer. */
  readonly asking: boolean;
  /** The form says whether it holds something the person entered; only then does leaving ask. */
  readonly track: (dirty: boolean) => void;
  /** Leaves, losing what was typed. */
  readonly discard: () => void;
  /** Stays on the form, with what was typed. */
  readonly keep: () => void;
}

/** "¿Descartar este gasto?": Descartar leaves; Seguir editando, Escape or closing the sheet stays. */
export function DiscardConfirm({ guard, kind }: { readonly guard: LeaveGuard; readonly kind: RecordKind }) {
  const t = useTranslations("ledger.form.discard");
  return (
    <Sheet
      open={guard.asking}
      // The sheet only ever closes itself; it is opened by a navigation, never by a trigger.
      onOpenChange={guard.keep}
      title={t(`title.${kind}`)}
      footer={
        <div className="flex flex-col gap-3">
          <Button variant="danger" size="lg" onClick={guard.discard}>
            {t("confirm")}
          </Button>
          <Button variant="secondary" size="lg" onClick={guard.keep}>
            {t("keep")}
          </Button>
        </div>
      }
    >
      {null}
    </Sheet>
  );
}
