import type { SpaceDto } from "@/shared/ui/api/dto";

/** Ruling P200: the views of the Plan tab; the first of a space's list is the tab's own page. */
export type PlanView = "lines" | "members" | "fund" | "groups" | "trend" | "mine" | "calendar";

const SHARED_VIEWS: readonly PlanView[] = ["lines", "members", "fund", "groups", "trend"];
const PERSONAL_VIEWS: readonly PlanView[] = ["mine", "calendar", "groups", "trend", "lines"];

export const viewsFor = (kind: SpaceDto["kind"]): readonly PlanView[] =>
  kind === "PERSONAL" ? PERSONAL_VIEWS : SHARED_VIEWS;

/**
 * `/spaces/{id}/plan` for the space's first view, `/spaces/{id}/plan/{view}` for the others; `?period=` kept. The
 * calendar is not a period view (ruling P241 of M6c), so its link never carries one.
 */
export const viewHref = (space: Pick<SpaceDto, "id" | "kind">, view: PlanView, period?: string): string => {
  const base = `/spaces/${space.id}/plan`;
  if (view === "calendar") return `${base}/calendar`;
  const path = viewsFor(space.kind)[0] === view ? base : `${base}/${view}`;
  return period ? `${path}?period=${encodeURIComponent(period)}` : path;
};

/** Ruling P241 (M6c): the calendar's window links. */
export const calendarHref = (space: Pick<SpaceDto, "id">, days: 30 | 60): string =>
  `/spaces/${space.id}/plan/calendar${days === 30 ? "" : `?days=${days}`}`;
