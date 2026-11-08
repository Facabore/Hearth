import dynamic from "next/dynamic";

/**
 * Ruling P311: Salir and Archivar ask in a sheet that loads only when one is tapped, in a chunk of its own, so the
 * space's Configuración keeps its script budget (ADR 0004) with its dropdown and its flat list.
 */
export const LazySpaceLifecycleSheet = dynamic(
  () => import("./space-lifecycle-sheet").then((module) => module.SpaceLifecycleSheet),
  { ssr: false },
);
