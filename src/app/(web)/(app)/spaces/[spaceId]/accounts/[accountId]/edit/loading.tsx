import { getTranslations } from "next-intl/server";
import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/** Issue #196: the edit of an account; the relative way back leads to the accounts, as the loaded screen's does. */
export default async function Loading() {
  const t = await getTranslations("accounts");
  return <LoadingScreen header={{ backHref: "../../accounts", title: t("edit.title") }} shape="form" />;
}
