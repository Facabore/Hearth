import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { personalSpaceOf } from "@/modules/spaces/ui";
import { SpaceSettingsScreen } from "@/modules/spaces/ui/screens";
import { useApis } from "../api";
import { useTitle } from "../title";
import { useViewer } from "../viewer";

const route = getRouteApi("/spaces/$spaceId/settings");

/** Ruling P309: a space's own settings, from the space switcher's "Ajustes de {space}". */
export function SpaceSettingsRoute() {
  const { spaceId } = route.useParams();
  const { api } = useApis();
  const { space, spaces } = useViewer(spaceId);
  useTitle(useTranslations("spaces.screen")("title", { space: space.name }));
  return (
    <div className="mx-auto max-w-[640px] py-3">
      <SpaceSettingsScreen space={space} homeHref={`/spaces/${personalSpaceOf(spaces).id}`} api={api} />
    </div>
  );
}
