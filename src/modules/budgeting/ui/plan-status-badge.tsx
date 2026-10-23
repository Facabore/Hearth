import { useTranslations } from "next-intl";
import { Badge } from "@/shared/ui";
import type { PlanStatus } from "@/shared/ui/api/dto";
import type { UiIconName } from "@/shared/ui/icons/ui-icons";

const LOOK = {
  DRAFT: { tone: "neutral", icon: "pencil" },
  ACTIVE: { tone: "accent", icon: "check" },
  CLOSED: { tone: "neutral", icon: "lock" },
} as const satisfies Record<PlanStatus, { tone: "neutral" | "accent"; icon: UiIconName }>;

/** Ruling P200: where a plan stands in its cycle, as words and an icon (never colour alone). */
export function PlanStatusBadge({ status }: { readonly status: PlanStatus }) {
  const t = useTranslations("budgeting.status");
  return (
    <Badge tone={LOOK[status].tone} icon={LOOK[status].icon}>
      {t(status)}
    </Badge>
  );
}
