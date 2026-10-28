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

/** A screen of a space reached from its home or the profile sheet, with its way back home. */
function SpaceScreenPending({
  title,
  back = "",
  shape,
}: {
  readonly title: string;
  readonly back?: string;
  readonly shape: "list" | "form";
}) {
  const { spaceId } = useParams({ strict: false });
  return <LoadingScreen header={{ backHref: `/spaces/${spaceId}${back}`, title }} shape={shape} />;
}

export const AccountsPending = () => (
  <SpaceScreenPending title={useTranslations("accounts")("title")} shape="list" />
);

export const NewAccountPending = () => (
  <SpaceScreenPending title={useTranslations("accounts")("newTitle")} back="/accounts" shape="form" />
);

export const EditAccountPending = () => (
  <SpaceScreenPending title={useTranslations("accounts")("edit.title")} back="/accounts" shape="form" />
);

export const CategoriesPending = () => (
  <SpaceScreenPending title={useTranslations("categories")("title")} shape="list" />
);

/** Settings and New space draw the shell themselves; until they can, their skeleton goes back to the app's root. */
export const SettingsPending = () => (
  <LoadingScreen header={{ backHref: "/", title: useTranslations("settings")("title") }} shape="form" />
);

export const NewSpacePending = () => (
  <LoadingScreen header={{ backHref: "/", title: useTranslations("spaces.new")("title") }} shape="form" />
);
