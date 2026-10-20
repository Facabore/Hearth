import { getTranslations } from "next-intl/server";
import { SettingsContainer } from "@/modules/identity/ui";

export async function generateMetadata() {
  return { title: (await getTranslations("settings"))("title") };
}

/** HU-E9-13: the Settings screen. */
export default async function SettingsPage() {
  const t = await getTranslations("settings");
  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-6 py-4">
      <h1 className="text-2xl font-semibold text-ink">{t("title")}</h1>
      <SettingsContainer />
    </div>
  );
}
