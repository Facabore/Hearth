import dynamic from "next/dynamic";

/**
 * Ruling P309: the add-guests sheet opens from Miembros and from the split sheet, so it loads when first opened, in a
 * chunk of its own: neither route carries its code (ADR 0004).
 */
export const LazyAddGuestsSheet = dynamic(
  () => import("./add-guests-sheet").then((module) => module.AddGuestsSheet),
  { ssr: false },
);
