import { getTranslations } from "next-intl/server";

/** The Home of a space; Task 17b fills it. */
export default async function SpaceHomePage() {
  const t = await getTranslations("home");
  return <h1 className="text-2xl font-semibold text-ink">{t("title")}</h1>;
}
