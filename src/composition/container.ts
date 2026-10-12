import { jsonLogger, type RouteDeps } from "@/shared/http";

/** Process-wide dependencies. Grows with the database, sessions and use cases in later tasks. */
export type Container = RouteDeps;

const buildContainer = (): Container => ({
  // Replaced by the Better Auth session resolver in Task 10.
  sessionResolver: { resolve: async () => null },
  logger: jsonLogger,
});

let container: Container | undefined;

export const getContainer = (): Container => (container ??= buildContainer());

export const setContainerForTests = (next: Container | undefined): void => {
  container = next;
};
