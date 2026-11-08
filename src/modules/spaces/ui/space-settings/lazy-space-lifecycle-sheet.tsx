import type { SpaceLifecycleSheet } from "./space-lifecycle-sheet";

/** The sheet that asks before leaving or archiving a space, once its code is here. */
export type LifecycleSheet = typeof SpaceLifecycleSheet;

let loading: Promise<LifecycleSheet> | undefined;

/**
 * Ruling P311: Salir and Archivar ask in a sheet whose code, with the sheet panel's, loads in a chunk of its own, so the
 * space's Configuración keeps its script budget (ADR 0004) with its dropdown and its flat list. A press starts the load
 * before the tap ends, and the row says it is on its way meanwhile; a load that fails (a flaky network, a chunk gone
 * after a release) is forgotten, so the next tap loads it again.
 */
export const loadSpaceLifecycleSheet = (): Promise<LifecycleSheet> =>
  (loading ??= Promise.all([
    import("./space-lifecycle-sheet"),
    // The sheet panel's code (Radix's dialog) comes beside it; the sheet then opens without a second wait.
    import("@/shared/ui/molecules/sheet-panel"),
  ]).then(
    ([module]) => module.SpaceLifecycleSheet,
    (error: unknown) => {
      loading = undefined;
      throw error;
    },
  ));
