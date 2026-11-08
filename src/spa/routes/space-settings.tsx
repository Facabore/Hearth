import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import {
  lazy,
  Suspense,
  useCallback,
  useState,
  type ComponentProps,
  type ComponentType,
  type LazyExoticComponent,
} from "react";
import { useTranslations } from "use-intl";
import { personalSpaceOf } from "@/modules/spaces/ui";
import { SpaceSettingsScreen } from "@/modules/spaces/ui/screens";
import { useApis } from "../api";
import { myBalancesQuery } from "../shell";
import type { SettingsStatus, StatusRow } from "../spaces/settings-status";
import { useTitle } from "../title";
import { useViewer } from "../viewer";

const route = getRouteApi("/spaces/$spaceId/settings");

/** What a row says while its status cannot load: nothing. */
type StatusComponent = ComponentType<ComponentProps<typeof SettingsStatus>>;
const Silent: StatusComponent = () => null;

/**
 * Ruling P311: the rows' statuses load in a chunk of their own, with the amount formats, after the screen paints. A
 * chunk that fails never reaches the route's error screen: the rows show without statuses (P300), and the next time
 * they draw, such as another space's Configuración or a later visit, the chunk loads afresh (React keeps a lazy
 * component's answer for good, as `next/dynamic`'s adapter says).
 */
const statusChunk = (): LazyExoticComponent<StatusComponent> =>
  lazy(() =>
    import("../spaces/settings-status").then(
      (module) => ({ default: module.SettingsStatus }),
      () => {
        Status = statusChunk();
        return { default: Silent };
      },
    ),
  );
let Status = statusChunk();

/** Ruling P311 (amends P309): a space's Configuración, from the header's ⚙ and Más. */
export function SpaceSettingsRoute() {
  const { spaceId } = route.useParams();
  const { api } = useApis();
  const viewer = useViewer(spaceId);
  const { space, spaces } = viewer;
  useTitle(useTranslations("spaces.screen")("title"));
  // The dropdown's "Compartido · N personas": the person's standing in each shared space names its current members,
  // guests included (P278); the space configured says what its Miembros row counts, from that row's own read.
  const shared = spaces.some((other) => other.kind !== "PERSONAL");
  const balances = useQuery({ ...myBalancesQuery(api), enabled: shared }).data;
  const [counted, setCounted] = useState<Readonly<Record<string, number>>>({});
  const onPeople = useCallback(
    (count: number) => setCounted((all) => (all[space.id] === count ? all : { ...all, [space.id]: count })),
    [space.id],
  );
  const people = {
    ...Object.fromEntries((balances ?? []).map((balance) => [balance.spaceId, balance.members.length])),
    ...counted,
  };
  const status = (row: StatusRow) => (
    <Suspense fallback={null}>
      <Status viewer={viewer} row={row} onPeople={onPeople} />
    </Suspense>
  );
  return (
    <div className="mx-auto max-w-[640px] py-3">
      <SpaceSettingsScreen
        // Another space's Configuración starts afresh: its dropdown and its name closed, its statuses loaded again.
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
