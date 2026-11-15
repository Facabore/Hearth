import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useTranslations } from "use-intl";
import { MoreScreen } from "@/modules/spaces/ui/screens";
import { useApis } from "../api";
import { spacesQuery } from "../queries";
import { useTitle } from "../title";

const route = getRouteApi("/spaces/$spaceId/more");

/** D27: the invite row loads on its own, so Más's chunk keeps to the grid; its place is kept while it loads. */
const Invite = lazy(() => import("../referrals/invite").then((module) => ({ default: module.Invite })));

/** Ruling P311: Más, the bar's fifth tab, the grid of the app's modules for the active space. */
export function MoreRoute() {
  useTitle(useTranslations("shell.more")("title"));
  const { spaceId } = route.useParams();
  // The shell's own read, already in the cache: the space of the URL is one of the person's.
  const personal = useSuspenseQuery(spacesQuery(useApis().api)).data.some(
    (space) => space.id === spaceId && space.kind === "PERSONAL",
  );
  return (
    <>
      <MoreScreen spaceId={spaceId} />
      {personal ? (
        <div className="mx-auto min-h-row-lg max-w-[640px] pb-3">
          <Suspense fallback={null}>
            <Invite spaceId={spaceId} />
          </Suspense>
        </div>
      ) : null}
    </>
  );
}
