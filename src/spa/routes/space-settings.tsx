import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useTranslations } from "use-intl";
import { personalSpaceOf } from "@/modules/spaces/ui";
import { SpaceSettingsScreen } from "@/modules/spaces/ui/screens";
import { useApis } from "../api";
import { myBalancesQuery } from "../shell";
import type { StatusRow } from "../spaces/settings-status";
import { useTitle } from "../title";
import { useViewer } from "../viewer";

const route = getRouteApi("/spaces/$spaceId/settings");

/** Ruling P311: the rows' statuses load in a chunk of their own, with the amount formats, after the screen paints. */
const Status = lazy(() =>
  import("../spaces/settings-status").then((module) => ({ default: module.SettingsStatus })),
);

/** Ruling P311 (amends P309): a space's Configuración, from the header's ⚙ and Más. */
export function SpaceSettingsRoute() {
  const { spaceId } = route.useParams();
  const { api } = useApis();
  const viewer = useViewer(spaceId);
  const { space, spaces } = viewer;
  useTitle(useTranslations("spaces.screen")("title"));
  // The dropdown's "Compartido · N personas": the person's standing in each shared space names its members (P278).
  const shared = spaces.some((other) => other.kind !== "PERSONAL");
  const balances = useQuery({ ...myBalancesQuery(api), enabled: shared }).data;
  const people = Object.fromEntries(
    (balances ?? []).map((balance) => [balance.spaceId, balance.members.length]),
  );
  const status = (row: StatusRow) => (
    <Suspense fallback={null}>
      <Status viewer={viewer} row={row} />
    </Suspense>
  );
  return (
    <div className="mx-auto max-w-[640px] py-3">
      <SpaceSettingsScreen
        // Another space's Configuración starts afresh: its dropdown and its name closed.
        key={space.id}
        space={space}
        spaces={spaces}
        people={people}
        status={{ plan: status("plan"), members: status("members"), recurring: status("recurring") }}
        homeHref={`/spaces/${personalSpaceOf(spaces).id}`}
        api={api}
      />
    </div>
  );
}
