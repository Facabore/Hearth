import { getTranslations } from "next-intl/server";
import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/** Issue #196: the record form. The relative way back leads to the space's home, as the loaded screen's does without a `returnTo`; a click returns to where the person was. */
export default async function Loading() {
  const t = await getTranslations("ledger");
  return (
    <div className="mx-auto max-w-[560px]">
      <LoadingScreen header={{ backHref: ".", title: t("form.title") }} shape="form" />
    </div>
  );
}
