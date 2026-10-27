import { getTranslations } from "next-intl/server";
import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/**
 * Issue #196: the settings. The page draws its own shell (it reads `?from=`), so the boundary keeps the shell's gutters
 * and header row; the way back is the start, the personal space's home, as the loaded screen's is without `?from=`.
 */
export default async function Loading() {
  const t = await getTranslations("settings");
  return (
    <div className="mx-auto max-w-[1200px] px-4 pt-12 max-[359px]:px-3">
      <div className="mx-auto max-w-[640px]">
        <LoadingScreen header={{ backHref: "/", title: t("title") }} shape="form" />
      </div>
    </div>
  );
}
