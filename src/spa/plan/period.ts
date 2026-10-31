import { useQuery, useSuspenseQueries } from "@tanstack/react-query";
import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import type { PeriodDto } from "@/shared/ui/api/dto";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import type { Viewer } from "../load";
import { periodQuery } from "../reads";
import { noPeriod } from "./loaders";

/** Ruling P205: the period asked for, else the one holding today in the person's zone, read as the loader did. */
export const useLabel = (viewer: Viewer, asked: string | undefined): string => {
  const { api } = useApis();
  const today = nowIn(new Date(), viewer.me.timezone).date;
  // Read only when no period is asked for; hooks are called the same way on every render.
  const queries: ReturnType<typeof periodQuery>[] = asked ? [] : [periodQuery(api, viewer.space.id, today)];
  const [held] = useSuspenseQueries({ queries });
  const label = asked ?? held?.data?.label;
  if (!label) throw noPeriod();
  return label;
};

/** The periods before and after the view's (P130); one that fails is just absent. */
export const useNeighbours = (spaceId: string, period: PeriodDto) => {
  const { api } = useApis();
  const previous = useQuery(periodQuery(api, spaceId, addDays(period.startDate as LocalDate, -1))).data;
  const next = useQuery(periodQuery(api, spaceId, addDays(period.endDate as LocalDate, 1))).data;
  return { previous: previous ?? null, next: next ?? null };
};
