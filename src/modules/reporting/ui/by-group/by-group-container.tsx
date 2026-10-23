import { getTranslations } from "next-intl/server";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { PeriodDto, SpendingByGroupDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { nowIn } from "@/shared/ui/time/when";
import { DashboardFrame } from "../dashboard-frame";
import { neighboursOf, periodLabel, spaceOf } from "../report-period";
import { SpendingChart } from "./spending-chart";
import { treeOf } from "./spending-tree";

/** HU-E9-10: the period's spending by group, read once (ruling P215), and the neighbouring periods (ruling P205). */
export const loadByGroup = async (
  api: Api,
  input: { spaceId: string; period?: string; today: string },
): Promise<Loaded<{ report: SpendingByGroupDto; previous: PeriodDto | null; next: PeriodDto | null }>> => {
  const label = await periodLabel(api, input.spaceId, input.period, input.today);
  if (!label.ok) return label;
  const report = await loaded(
    api.GET("/api/v1/spaces/{spaceId}/reports/spending-by-group", {
      params: { path: { spaceId: input.spaceId }, query: { period: label.data } },
    }),
  );
  if (!report.ok) return report;
  return {
    ok: true,
    data: { report: report.data, ...(await neighboursOf(api, input.spaceId, report.data.period)) },
  };
};

/** Server: the By group view of the Plan tab for `?period=`, in the person's formats. */
export async function SpendingByGroupContainer({
  spaceId,
  period,
}: {
  readonly spaceId: string;
  readonly period?: string;
}) {
  const [me, spaces, t] = await Promise.all([getMe(), getSpaces(), getTranslations("reports")]);
  const space = spaceOf(spaces, spaceId);
  const result = await loadByGroup(await serverApi(), {
    spaceId,
    period,
    today: nowIn(serverNow(), me!.timezone).date,
  });
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  const { report, previous, next } = result.data;
  const formats = me!.preferences.effective;
  return (
    // The report names no plan, so the frame shows no plan badge or link on this view.
    <DashboardFrame
      space={space}
      view="groups"
      period={report.period}
      previous={previous}
      next={next}
      formats={formats}
      plan={null}
    >
      <SpendingChart
        tree={treeOf(report.groups)}
        total={report.total}
        formats={formats}
        note={t("byGroup.spaceNote")}
      />
    </DashboardFrame>
  );
}
