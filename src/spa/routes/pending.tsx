import { useParams } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/**
 * Issue #196's skeletons, for a screen visited for the first time while its reads are under way; a screen already in
 * the query cache never shows one (ADR 0006).
 */
export const HomePending = () => <LoadingScreen shape="cards" />;

export const ListPending = () => <LoadingScreen shape="list" />;

export function RecordPending() {
  const t = useTranslations("ledger");
  const { spaceId } = useParams({ strict: false });
  return <LoadingScreen header={{ backHref: `/spaces/${spaceId}`, title: t("form.title") }} shape="form" />;
}

export function EditPending() {
  const t = useTranslations("ledger");
  const { spaceId } = useParams({ strict: false });
  return (
    <LoadingScreen
      header={{ backHref: `/spaces/${spaceId}/transactions`, title: t("edit.title") }}
      shape="form"
    />
  );
}
