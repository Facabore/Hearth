import type { WritePlanner } from "./write-plan";

export { trackWrites } from "./writes";

const combined =
  (planners: readonly WritePlanner[]): WritePlanner =>
  (call, queryClient) => {
    for (const planner of planners) {
      const plan = planner(call, queryClient);
      if (plan) return plan;
    }
    return null;
  };

/**
 * Every module's write plans (ADR 0006), loaded with the first write or with the first signed-in screen, together with
 * the mutation runner, so a first save waits on no download. Never with the app shell.
 */
export const appWrites = (): Promise<WritePlanner> =>
  Promise.all([
    import("./ledger/writes"),
    import("./accounts/writes"),
    import("./categories/writes"),
    import("./spaces/writes"),
    import("./plan/writes"),
    import("./mutations"),
  ]).then(([ledger, accounts, categories, spaces, plan]) =>
    combined([
      ledger.ledgerWrites,
      accounts.accountWrites,
      categories.categoryWrites,
      spaces.spaceWrites,
      plan.planWrites,
    ]),
  );
