import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { MoreScreen } from "@/modules/spaces/ui/screens";
import { useTitle } from "../title";

const route = getRouteApi("/spaces/$spaceId/more");

/** Ruling P311: Más, the bar's fifth tab, the grid of the app's modules for the active space. */
export function MoreRoute() {
  useTitle(useTranslations("shell.more")("title"));
  return <MoreScreen spaceId={route.useParams().spaceId} />;
}
