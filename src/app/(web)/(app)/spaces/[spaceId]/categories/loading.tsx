import { getTranslations } from "next-intl/server";
import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/** Issue #196: the categories of a space; the relative way back leads to the space's home, as the loaded screen's does. */
export default async function Loading() {
  const t = await getTranslations("categories");
  return (
    <div className="mx-auto max-w-[720px]">
      <LoadingScreen header={{ backHref: ".", title: t("title") }} shape="list" />
    </div>
  );
}
