import type { SpaceDto } from "@/shared/ui/api/dto";

/** Ruling P200: the views of the Plan tab; the first of a space's list is the tab's own page. */
export type PlanView = "lines" | "members" | "fund" | "groups" | "trend" | "mine";

const SHARED_VIEWS: readonly PlanView[] = ["lines", "members", "fund"];
const PERSONAL_VIEWS: readonly PlanView[] = ["lines"];

export const viewsFor = (kind: SpaceDto["kind"]): readonly PlanView[] =>
  kind === "PERSONAL" ? PERSONAL_VIEWS : SHARED_VIEWS;

/** `/spaces/{id}/plan` for the space's first view, `/spaces/{id}/plan/{view}` for the others; `?period=` kept. */
export const viewHref = (space: Pick<SpaceDto, "id" | "kind">, view: PlanView, period?: string): string => {
  const base = `/spaces/${space.id}/plan`;
  const path = viewsFor(space.kind)[0] === view ? base : `${base}/${view}`;
  return period ? `${path}?period=${encodeURIComponent(period)}` : path;
};
