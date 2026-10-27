import { getTranslations } from "next-intl/server";
import { LoadingScreen } from "@/shared/ui/molecules/loading-screen";

/** Issue #196: the capacities of a plan; the relative way back is its planner. */
export default async function Loading() {
  const t = await getTranslations("budgeting.capacity");
  return <LoadingScreen header={{ backHref: ".", title: t("title") }} shape="form" />;
}
