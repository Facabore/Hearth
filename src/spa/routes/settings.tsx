import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { SettingsForm } from "@/modules/identity/ui";
import { spaceHomeHref } from "@/modules/spaces/ui";
import { NotFoundScreen } from "@/shared/ui";
import { useApis } from "../api";
import { meQuery, spacesQuery } from "../queries";
import { useTitle } from "../title";
import { ShellFrame } from "./space-shell";

const settings = getRouteApi("/settings");

/**
 * HU-E9-13: the Settings screen (the form renders its own heading). `?from=` is the space the person came from: Volver
 * returns to its home and, when it is one of hers, the shell around the screen is that space's (N3). Ruling P309: only
 * the person's and the app's settings; a space's name and color moved to its own settings (`/spaces/{id}/settings`).
 */
export function SettingsRoute() {
  useTitle(useTranslations("settings")("title"));
  const { from } = settings.useSearch();
  const { api, sessionApi } = useApis();
  const me = useSuspenseQuery(meQuery(sessionApi)).data;
  const spaces = useSuspenseQuery(spacesQuery(api)).data;
  if (!me) return <NotFoundScreen />;
  return (
    <ShellFrame spaceId={null} from={from}>
      <div className="mx-auto flex max-w-[640px] flex-col gap-3 py-3">
        <SettingsForm me={me} backHref={spaceHomeHref(spaces, from)} />
      </div>
    </ShellFrame>
  );
}
