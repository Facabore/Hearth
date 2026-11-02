import { useTranslations } from "next-intl";
import { Button, Icon, Sheet } from "@/shared/ui";

export type LifecycleAction = "activate" | "close";

/**
 * HU-E9-08, boards 08 and 09 of "Pantallas nuevas": what activating or closing a plan does, said before it is done.
 * "Ahora no" and the confirmation sit side by side; the confirmation stays disabled while the call is pending, so a
 * second click acts once.
 */
export function LifecycleConfirm({
  action,
  period,
  pending,
  onConfirm,
  onOpenChange,
}: {
  /** The action being confirmed, or null while the sheet is closed. */
  readonly action: LifecycleAction | null;
  /** The plan's period as a word in a sentence ("noviembre"). */
  readonly period: string;
  readonly pending: boolean;
  readonly onConfirm: (action: LifecycleAction) => void;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("budgeting.planner");
  const tCommon = useTranslations("common");
  const points =
    action === "close"
      ? [t("confirmClose.readOnly", { period }), t("confirmClose.leftover")]
      : [
          t("confirmActivate.splitDefault"),
          t("confirmActivate.countsAgainst", { period }),
          t("confirmActivate.stillEditable"),
        ];
  return (
    <Sheet
      open={action !== null}
      onOpenChange={onOpenChange}
      title={t(action === "close" ? "confirmClose.title" : "confirmActivate.title", { period })}
      footer={
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
            {tCommon("notNow")}
          </Button>
          <Button size="lg" disabled={pending} onClick={() => action !== null && onConfirm(action)}>
            {t(action === "close" ? "close" : "activate")}
          </Button>
        </div>
      }
    >
      <ul className="flex flex-col gap-3 py-1">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-3 text-base text-ink">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
              <Icon name="check" size={16} />
            </span>
            <span className="[overflow-wrap:anywhere]">{point}</span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
