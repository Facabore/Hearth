import { getTranslations } from "next-intl/server";
import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/** Issue #196: the edit of an account; the relative way back is the accounts. */
export default async function Loading() {
  const t = await getTranslations("accounts");
  return <LoadingScreen header={{ backHref: "../../accounts", title: t("edit.title") }} shape="form" />;
}
