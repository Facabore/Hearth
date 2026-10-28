import type { Api } from "@/shared/ui/api/client";
import { loaded } from "@/shared/ui/api/server";
import type { Overview } from "./overview";

export type { Overview };

/** Ruling P216: the desktop panels, read in parallel for the period the line dashboard named; a failed read is left out. */
export const loadOverview = async (
  api: Api,
  { spaceId, period }: { spaceId: string; period: string },
): Promise<Overview> => {
  const path = { spaceId };
  const query = { period };
  const [matrix, fund, groups, trend, members] = await Promise.all([
    loaded(api.GET("/api/v1/spaces/{spaceId}/reports/member-matrix", { params: { path, query } })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/reports/fund-contributions", { params: { path, query } })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/reports/spending-by-group", { params: { path, query } })),
    loaded(
      api.GET("/api/v1/spaces/{spaceId}/reports/trend", {
        params: { path, query: { endPeriod: period, periods: 2 } },
      }),
    ),
    loaded(api.GET("/api/v1/spaces/{spaceId}/members", { params: { path } })),
  ]);
  return {
    matrix: matrix.ok ? matrix.data : null,
    fund: fund.ok ? fund.data : null,
    groups: groups.ok ? groups.data : null,
    trend: trend.ok ? trend.data : null,
    members: members.ok ? members.data.items : [],
  };
};
