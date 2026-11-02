/**
 * HU-E9-09's query keys (ADR 0006), keyed by module and space first, so a write can invalidate every recurrence of a
 * space at once. A module with no imports, so the shell's badge reads them without the loaders' code.
 */
export const recurrenceKeys = {
  space: (spaceId: string) => ["recurrences", spaceId] as const,
  list: (spaceId: string) => ["recurrences", spaceId, "list"] as const,
  one: (spaceId: string, recurrenceId: string) => ["recurrences", spaceId, "one", recurrenceId] as const,
  upcoming: (spaceId: string, recurrenceId: string) =>
    ["recurrences", spaceId, "upcoming", recurrenceId] as const,
  /** "Por confirmar" (P270), under the same space key, so a confirmation or a skip invalidates it with the rest. */
  pending: (spaceId: string) => ["recurrences", spaceId, "pending"] as const,
};
