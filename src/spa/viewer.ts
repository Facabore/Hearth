import { useSuspenseQuery } from "@tanstack/react-query";
import { notFound } from "@tanstack/react-router";
import { useApis } from "./api";
import type { Viewer } from "./load";
import { meQuery, spacesQuery } from "./queries";

/** The person and the URL's space, from the cache the guards and the shell filled. */
export const useViewer = (spaceId: string): Viewer => {
  const { api, sessionApi } = useApis();
  const me = useSuspenseQuery(meQuery(sessionApi)).data;
  const spaces = useSuspenseQuery(spacesQuery(api)).data;
  const space = spaces.find((s) => s.id === spaceId);
  if (!me || !space) throw notFound();
  return { me, spaces, space };
};
