import type { SpaceDto } from "@/shared/ui/api/dto";

/** Ruling P200: the views of the Plan tab; the first of a space's list is the tab's own page. */
export type PlanView = "lines" | "members" | "fund" | "groups" | "trend" | "mine" | "calendar";

/**
 * Decision U3 (#224): one order for every space, Rubros · Por grupo · Miembros · Fondo · Tendencia, so a view sits in
 * the same place wherever the person is. Ruling P266: the personal space keeps My spending first, as its Plan tab's own
 * page (P200), and Próximos last; each space shows the views of that order it has.
 */
const ORDER: readonly PlanView[] = ["mine", "lines", "groups", "members", "fund", "trend", "calendar"];
const PERSONAL_ONLY: ReadonlySet<PlanView> = new Set(["mine", "calendar"]);
const SHARED_ONLY: ReadonlySet<PlanView> = new Set(["members", "fund"]);

const SHARED_VIEWS = ORDER.filter((view) => !PERSONAL_ONLY.has(view));
const PERSONAL_VIEWS = ORDER.filter((view) => !SHARED_ONLY.has(view));

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
