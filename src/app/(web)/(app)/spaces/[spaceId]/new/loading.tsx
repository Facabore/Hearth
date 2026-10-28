import { getTranslations } from "next-intl/server";
import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/** Issue #196: the record form; the relative way back is the space's home, the loaded screen's without a `returnTo`. */
export default async function Loading() {
  const t = await getTranslations("ledger");
  return (
    <div className="mx-auto max-w-[560px]">
      <LoadingScreen header={{ backHref: ".", title: t("form.title") }} shape="form" />
    </div>
  );
}
