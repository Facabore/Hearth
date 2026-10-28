import type { QueryClient } from "@tanstack/react-query";
import type { MeDto, SpaceDto } from "@/shared/ui/api/dto";
import type { RouterContext } from "./guards";
import { meQuery, spacesQuery } from "./queries";

// What every screen's loader shares (ADR 0006): why it runs, how it reads the cache, and the person and space it is for.

export interface Viewer {
  readonly me: MeDto;
  readonly spaces: readonly SpaceDto[];
  readonly space: SpaceDto;
}

/** The person and the space of the URL; the shell's loader already answered a space they are not in. */
export const viewerOf = async (
  { queryClient, apis }: RouterContext,
  spaceId: string,
): Promise<Viewer | null> => {
  const [me, spaces] = await Promise.all([
    queryClient.ensureQueryData(meQuery(apis.sessionApi)),
    queryClient.ensureQueryData(spacesQuery(apis.api)),
  ]);
  const space = spaces.find((s) => s.id === spaceId);
  return me && space ? { me, spaces, space } : null;
};

export const sharedSpace = (space: SpaceDto) => space.kind !== "PERSONAL";

/**
 * A route's loader: its router context, and why it runs. TanStack Router says "enter" for a visit, "preload" for a
 * prefetch on intent, and "stay" when only the address of the screen on display changed (a sheet, a filter).
 */
export interface Load extends RouterContext {
  readonly cause: "enter" | "stay" | "preload";
}

/**
 * ADR 0006's stale-while-revalidate: a read already in the cache resolves at once, and arriving at a screen (a visit,
 * or the prefetch a tap then reuses) refreshes it in the background, so the screen paints from the cache and then
 * shows what changed elsewhere. Staying on the screen reads only what it is missing: opening a sheet or closing it reads
 * the list again for nothing. A read not in the cache is waited for.
 */
export const ensurer =
  ({ queryClient, cause }: Load): QueryClient["ensureQueryData"] =>
  (options) =>
    queryClient.ensureQueryData({ ...options, revalidateIfStale: cause !== "stay" });
