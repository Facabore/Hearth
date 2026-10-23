// Server Components only: it reads through the request-scoped API client.
import { notFound } from "next/navigation";
import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import type { Api } from "@/shared/ui/api/client";
import type { PeriodDto, SpaceDto } from "@/shared/ui/api/dto";
import { loaded, type Loaded } from "@/shared/ui/api/server";

/** Ruling P205: the label asked for, else the label of the period of the space that holds `today`. */
export const periodLabel = async (
  api: Api,
  spaceId: string,
  asked: string | undefined,
  today: string,
): Promise<Loaded<string>> => {
  if (asked) return { ok: true, data: asked };
  const result = await loaded(
    api.GET("/api/v1/spaces/{spaceId}/periods", {
      params: { path: { spaceId }, query: { from: today, count: 1 } },
    }),
  );
  if (!result.ok) return result;
  const first = result.data.items[0];
  return first
    ? { ok: true, data: first.label }
    : { ok: false, problem: { code: "Unknown", status: 200, requestId: null, errors: [], field: null } };
};

/** The periods before and after `period`: from the day before its start and the day after its end (P130). */
export const neighboursOf = async (
  api: Api,
  spaceId: string,
  period: PeriodDto,
): Promise<{ previous: PeriodDto | null; next: PeriodDto | null }> => {
  const one = async (from: string) => {
    const result = await loaded(
      api.GET("/api/v1/spaces/{spaceId}/periods", {
        params: { path: { spaceId }, query: { from, count: 1 } },
      }),
    );
    return result.ok ? (result.data.items[0] ?? null) : null;
  };
  const [previous, next] = await Promise.all([
    one(addDays(period.startDate as LocalDate, -1)),
    one(addDays(period.endDate as LocalDate, 1)),
  ]);
  return { previous, next };
};

/** The page's space among the person's spaces; a space they are not in is not found. */
export const spaceOf = (spaces: readonly SpaceDto[], spaceId: string): SpaceDto =>
  spaces.find((space) => space.id === spaceId) ?? notFound();
