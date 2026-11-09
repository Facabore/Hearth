import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
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
export function SettingsStatus({
  viewer,
  row,
  onPeople,
}: {
  readonly viewer: Viewer;
  readonly row: StatusRow;
  /** How many people the Miembros row counts, once read, so the space dropdown says the same. */
  readonly onPeople?: (count: number) => void;
}) {
  if (row === "plan") return <PlanStatus viewer={viewer} />;
  if (row === "members") return <MembersStatus viewer={viewer} onPeople={onPeople} />;
  return <RecurringStatus viewer={viewer} />;
}

/**
 * "Quedan $ 380.000" while the period holding today has a plan with something left, "Te pasaste $ 45.000" once its
 * spending went past it (the words carry the direction, never a sign or color alone), "Sin plan" when it has none.
 */
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
  // #283 (ruling P313): what is left to spend, savings apart, as the API answers it.
  const left = dashboard.totals.withoutSavings?.available ?? dashboard.totals.available;
  // The amount without its sign: the words say which way it went.
  const amount = formatMoney(
    { ...left, amount: left.amount.replace(/^-/, "") },
    viewer.me.preferences.effective,
  );
  return BigInt(left.amount) < 0n ? t("planOver", { amount }) : t("planLeft", { amount });
}

/** "4 personas": the space's current members, guests included. */
function MembersStatus({
  viewer,
  onPeople,
}: {
  readonly viewer: Viewer;
  readonly onPeople: ((count: number) => void) | undefined;
}) {
  const t = useTranslations("spaces.screen");
  const { api } = useApis();
  const members = useQuery(membersQuery(api, viewer.space.id)).data;
  const count = members?.length;
  useEffect(() => {
    if (count !== undefined) onPeople?.(count);
  }, [count, onPeople]);
  return members ? t("people", { count: members.length }) : null;
}

/** "2 por confirmar": what the Movimientos badge counts, for someone who records money there; nothing at zero. */
function RecurringStatus({ viewer }: { readonly viewer: Viewer }) {
  const t = useTranslations("recurrences.pending");
  const count = usePendingCount(viewer.space);
  return count > 0 ? t("badge", { count }) : null;
}
