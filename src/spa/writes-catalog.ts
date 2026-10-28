import type { WritePlanner } from "./write-plan";

export { trackWrites } from "./writes";

/**
 * The ledger's write plans, loaded with the first write or with the first screen that can write (ADR 0006), together
 * with the mutation runner, so that first save waits on no download.
 */
export const ledgerWrites = (): Promise<WritePlanner> =>
  Promise.all([import("./ledger/writes"), import("./mutations")]).then(([module]) => module.ledgerWrites);
