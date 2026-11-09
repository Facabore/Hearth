import dynamic from "next/dynamic";

/**
 * Ruling P311: Próximos, the personal space's calendar, loads in a chunk of its own when its view opens, so the Plan
 * views keep their script budget (ADR 0004) now that each wears its way back to the space's Configuración.
 */
export const LazyCashFlowCalendar = dynamic(
  () => import("./cash-flow-calendar").then((module) => module.CashFlowCalendar),
  { ssr: false },
);
