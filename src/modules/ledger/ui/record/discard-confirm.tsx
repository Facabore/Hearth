import { useTranslations } from "next-intl";
import { DiscardConfirm as Question } from "@/shared/ui/molecules/discard-confirm";
import type { RecordKind } from "./record-request";

export type { HoldNavigation } from "@/shared/ui/navigation/hold-navigation";

/** Issue #215: "¿Descartar este gasto?": Descartar leaves; Seguir editando, Escape or closing the sheet stays. */
export function DiscardConfirm({
  kind,
  answer,
}: {
  readonly kind: RecordKind;
  /** true leaves, false stays. */
  readonly answer: (leave: boolean) => void;
}) {
  const t = useTranslations("ledger.form.discard");
  return <Question title={t(`title.${kind}`)} confirm={t("confirm")} keep={t("keep")} answer={answer} />;
}
