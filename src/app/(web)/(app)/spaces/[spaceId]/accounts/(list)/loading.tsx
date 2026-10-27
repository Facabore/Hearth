import { getTranslations } from "next-intl/server";
import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/** Issue #196: the accounts; the relative way back is the space's home. */
export default async function Loading() {
  const t = await getTranslations("accounts");
  return <LoadingScreen header={{ backHref: ".", title: t("title") }} shape="list" />;
}
