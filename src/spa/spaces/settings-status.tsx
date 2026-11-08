import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "use-intl";
import { formatMoney } from "@/shared/ui/format/formatters";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import type { Viewer } from "../load";
import { usePendingCount } from "../recurring-pending/queries";
import { lineReportQuery, membersQuery, periodQuery } from "../reads";

/** The rows of the space's Configuración that say something on their right (ruling P311). */
export type StatusRow = "plan" | "members" | "recurring";

/**
 * Ruling P311: what a row of the space's Configuración says on its right, read when the screen shows and never blocking
 * it. Its chunk loads after the screen's, with the amount formats, so the Configuración route keeps its budget
 * (ADR 0004). A read that fails says nothing.
 */
export function SettingsStatus({ viewer, row }: { readonly viewer: Viewer; readonly row: StatusRow }) {
  if (row === "plan") return <PlanStatus viewer={viewer} />;
  if (row === "members") return <MembersStatus viewer={viewer} />;
  return <RecurringStatus viewer={viewer} />;
}

/** "Quedan $ 380.000" while the period holding today has a plan with something left, "Sin plan" when it has none. */
function PlanStatus({ viewer }: { readonly viewer: Viewer }) {
  const t = useTranslations("spaces.screen");
  const { api } = useApis();
  const today = nowIn(new Date(), viewer.me.timezone).date;
  const period = useQuery(periodQuery(api, viewer.space.id, today)).data;
  const dashboard = useQuery({
    ...lineReportQuery(api, viewer.space.id, period?.label ?? ""),
    enabled: period !== undefined && period !== null,
  }).data;
  if (!dashboard) return null;
  if (dashboard.plan === null) return t("noPlan");
  const left = dashboard.totals.available;
  return BigInt(left.amount) < 0n
    ? null
    : t("planLeft", { amount: formatMoney(left, viewer.me.preferences.effective) });
}

/** "4 personas": the space's current members, guests included. */
function MembersStatus({ viewer }: { readonly viewer: Viewer }) {
  const t = useTranslations("spaces.screen");
  const { api } = useApis();
  const members = useQuery(membersQuery(api, viewer.space.id)).data;
  return members ? t("people", { count: members.length }) : null;
}

/** "2 por confirmar": what the Movimientos badge counts, for someone who records money there; nothing at zero. */
function RecurringStatus({ viewer }: { readonly viewer: Viewer }) {
  const t = useTranslations("recurrences.pending");
  const count = usePendingCount(viewer.space);
  return count > 0 ? t("badge", { count }) : null;
}
