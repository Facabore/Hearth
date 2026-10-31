import type { SpaceDto } from "@/shared/ui/api/dto";

/** Ruling P200: the views of the Plan tab; the first of a space's list is the tab's own page. */
export type PlanView = "lines" | "members" | "fund" | "groups" | "trend" | "calendar";

/**
 * Decision U3 (#224): one order for every space, Rubros · Por grupo · Miembros · Fondo · Tendencia, so a view sits in
 * the same place wherever the person is, and Próximos last (P266); each space shows the views of that order it has.
 * Ruling P267: Mi consumo is a stacked screen of its own (U10), so Rubros is the personal Plan tab's own page too.
 */
const ORDER: readonly PlanView[] = ["lines", "groups", "members", "fund", "trend", "calendar"];
const PERSONAL_ONLY: ReadonlySet<PlanView> = new Set(["calendar"]);
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

/** Ruling P267 (U10, U4): Mi consumo, the stacked screen Inicio's shortcut opens; `?period=` kept. */
export const myConsumptionHref = (space: Pick<SpaceDto, "id">, period?: string): string => {
  const path = `/spaces/${space.id}/my-consumption`;
  return period ? `${path}?period=${encodeURIComponent(period)}` : path;
};

/** Ruling P241 (M6c): the calendar's window links. */
export const calendarHref = (space: Pick<SpaceDto, "id">, days: 30 | 60): string =>
  `/spaces/${space.id}/plan/calendar${days === 30 ? "" : `?days=${days}`}`;
