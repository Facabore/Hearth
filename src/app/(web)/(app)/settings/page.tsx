import { getTranslations } from "next-intl/server";
import { SettingsContainer } from "@/modules/identity/ui";

export async function generateMetadata() {
  return { title: (await getTranslations("settings"))("title") };
}

/** HU-E9-13: the Settings screen (the form renders its own heading). */
export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-[640px] py-4">
      <SettingsContainer />
    </div>
  );
}
