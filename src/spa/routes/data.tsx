import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { ExportScreen, ImportHubScreen } from "@/modules/portability/ui/screens";
import { personalSpaceOf } from "@/modules/spaces/ui";
import { useToast } from "@/shared/ui/molecules/toast";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import { importHistoryQuery } from "../portability/queries";
import { useTitle } from "../title";
import { useViewer } from "../viewer";

const hub = getRouteApi("/spaces/$spaceId/data");
const exporting = getRouteApi("/spaces/$spaceId/data/export");

/**
 * D28: Importar y exportar, from Más (#279), back to the Más it came from. The imports are the personal space's,
 * whatever space the person is in; an undo reads every screen again, since it touched accounts, categories and
 * movements.
 */
export function ImportHubRoute() {
  const t = useTranslations("portability.hub");
  useTitle(t("title"));
  const { spaceId } = hub.useParams();
  const { api } = useApis();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { me, spaces } = useViewer(spaceId);
  const personal = personalSpaceOf(spaces);
  const history = useSuspenseQuery(importHistoryQuery(api, personal.id)).data;
  return (
    <ImportHubScreen
      place={{ backHref: `/spaces/${spaceId}/more`, base: `/spaces/${spaceId}/data`, personal }}
      history={history.items}
      formats={me.preferences.effective}
      today={nowIn(new Date(), me.timezone).date}
      timeZone={me.timezone}
      onUndone={() => {
        toast.show({ message: t("undone") });
        void queryClient.invalidateQueries();
      }}
    />
  );
}

/** D28: Descargar mis datos, back to Importar y exportar. */
export function ExportRoute() {
  useTitle(useTranslations("portability.export")("title"));
  const { spaceId } = exporting.useParams();
  const { spaces } = useViewer(spaceId);
  return <ExportScreen backHref={`/spaces/${spaceId}/data`} spaces={spaces} />;
}
