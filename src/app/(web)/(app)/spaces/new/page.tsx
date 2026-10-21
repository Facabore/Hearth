import { getTranslations } from "next-intl/server";
import { NewSpaceForm } from "@/modules/spaces/ui";

export async function generateMetadata() {
  return { title: (await getTranslations("spaces.new"))("title") };
}

/** HU-E9-05: create a shared space (a name and a currency), inside the shell of the personal space. */
export default async function NewSpacePage() {
  const t = await getTranslations("spaces.new");
  return (
    <div className="mx-auto max-w-[560px]">
      <h1 className="pt-4 text-2xl font-semibold text-ink">{t("title")}</h1>
      <NewSpaceForm />
    </div>
  );
}
