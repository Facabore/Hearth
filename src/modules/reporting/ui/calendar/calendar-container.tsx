import { notFound } from "next/navigation";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import { getMe, getSpaces, loaded, serverApi } from "@/shared/ui/api/server";
import { spaceOf } from "../report-period";
import { CashFlowCalendar } from "./cash-flow-calendar";

/** Ruling P241 (M6c): `?days=60` asks for 60 days; anything else is the default 30. */
export const daysOf = (asked: string | undefined): 30 | 60 => (asked === "60" ? 60 : 30);

/** #150: the caller's own cash flow over the window, as `GET /api/v1/me/cash-flow` answers it (ruling P201). */
export const loadCashFlow = (api: Api, days: 30 | 60) =>
  loaded(api.GET("/api/v1/me/cash-flow", { params: { query: { days: String(days) as "30" | "60" } } }));

/** Server: the personal space's Próximos view (#150); a shared space has no calendar (ruling P241 of M6c). */
export async function CalendarContainer({
  spaceId,
  days,
}: {
  readonly spaceId: string;
  readonly days?: string;
}) {
  // A shared space has no calendar: the read waits for that check, never for the person (issue #196).
  const spaceRead = getSpaces().then((spaces) => {
    const space = spaceOf(spaces, spaceId);
    if (space.kind !== "PERSONAL") notFound();
    return space;
  });
  const read = Promise.all([serverApi(), spaceRead]).then(([api]) => loadCashFlow(api, daysOf(days)));
  void read.catch(() => undefined);
  const [me, space] = await Promise.all([getMe(), spaceRead]);
  const flow = await read;
  if (!flow.ok) return <ProblemNotice problem={flow.problem} />;
  return <CashFlowCalendar space={space} flow={flow.data} formats={me!.preferences.effective} />;
}
