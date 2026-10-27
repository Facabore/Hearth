import { getTranslations } from "next-intl/server";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { PeriodDto, PersonalSpendingByGroupDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { nowIn } from "@/shared/ui/time/when";
import { DashboardFrame } from "../dashboard-frame";
import { neighboursOf, periodLabel, spaceOf } from "../report-period";
import { SpendingChart } from "./spending-chart";
import { treeOf } from "./spending-tree";

/**
 * HU-E9-11: the caller's spending by group for the personal space's period (D11, ruling P205), read once (ruling
 * P215), and the personal space's neighbouring periods.
 */
export const loadPersonalByGroup = async (
  api: Api,
  input: {
    spaceId: string;
    period?: string;
    /** Today in the person's zone; it names the period only when none is asked for, so it may still be arriving. */
    today: string | PromiseLike<string>;
  },
): Promise<
  Loaded<{ report: PersonalSpendingByGroupDto; previous: PeriodDto | null; next: PeriodDto | null }>
> => {
  // An asked period never waits for the person: only today's period needs their zone (issue #196).
  const label = await periodLabel(api, input.spaceId, input.period, input.period ? "" : await input.today);
  if (!label.ok) return label;
  const report = await loaded(
    api.GET("/api/v1/me/reports/spending-by-group", { params: { query: { period: label.data } } }),
  );
  if (!report.ok) return report;
  return {
    ok: true,
    data: { report: report.data, ...(await neighboursOf(api, input.spaceId, report.data.period)) },
  };
};

/** Server: the By group view of the personal space's Plan tab for `?period=`, in the person's formats. */
export async function PersonalSpendingByGroupContainer({
  spaceId,
  period,
}: {
  readonly spaceId: string;
  readonly period?: string;
}) {
  const meRead = getMe();
  const today = meRead.then((me) => nowIn(serverNow(), me!.timezone).date);
  // An asked period leaves today unread; a failed read of the person throws below, never as an unhandled rejection.
  void today.catch(() => undefined);
  // The reads wait for the space check, never for the person: only today's period needs their zone (issue #196).
  const spaceRead = getSpaces().then((spaces) => spaceOf(spaces, spaceId));
  const read = Promise.all([serverApi(), spaceRead]).then(([api]) =>
    loadPersonalByGroup(api, {
      spaceId,
      period,
      today,
    }),
  );
  void read.catch(() => undefined);
  const [me, space, t] = await Promise.all([meRead, spaceRead, getTranslations("reports")]);
  const result = await read;
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
        note={t("byGroup.personalNote")}
      />
    </DashboardFrame>
  );
}
