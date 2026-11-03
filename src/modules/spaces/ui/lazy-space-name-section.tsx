import dynamic from "next/dynamic";

/**
 * #167: the rename section sits under Ajustes' form, so it loads after the screen does, in a chunk of its own: the
 * Settings route keeps its budget (ADR 0004) without it.
 */
export const LazySpaceNameSection = dynamic(
  () => import("./space-name-section").then((module) => module.SpaceNameSection),
  { ssr: false },
);
