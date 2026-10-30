import { useTranslations } from "next-intl";
import { Button, Sheet } from "@/shared/ui";
import type { RecordKind } from "./record-request";

/**
 * Issue #215 (F9 of the UX audit): holds every navigation away from the form (Volver, the system back, another screen)
 * while it has something typed. The app's router gives it; `stay` is asked before leaving, and the navigation goes on
 * only once it resolves false. It returns the release, called once the form no longer needs holding.
 */
export type HoldNavigation = (stay: () => Promise<boolean>) => () => void;

/** "¿Descartar este gasto?": Descartar leaves; Seguir editando, Escape or closing the sheet stays. */
export function DiscardConfirm({
  kind,
  answer,
}: {
  readonly kind: RecordKind;
  /** true leaves, false stays. */
  readonly answer: (leave: boolean) => void;
}) {
  const t = useTranslations("ledger.form.discard");
  return (
    <Sheet
      open
      // The sheet only ever closes itself; it is opened by a navigation, never by a trigger.
      onOpenChange={() => answer(false)}
      title={t(`title.${kind}`)}
      footer={
        <div className="flex flex-col gap-3">
          <Button variant="danger" size="lg" onClick={() => answer(true)}>
            {t("confirm")}
          </Button>
          <Button variant="secondary" size="lg" onClick={() => answer(false)}>
            {t("keep")}
          </Button>
        </div>
      }
    >
      {null}
    </Sheet>
  );
}
