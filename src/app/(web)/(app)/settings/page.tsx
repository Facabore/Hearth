import { getTranslations } from "next-intl/server";
import { SettingsContainer } from "@/modules/identity/ui/server";
import { spaceHomeHref } from "@/modules/spaces/ui";
import { getSpaces } from "@/shared/ui/api/server";

export async function generateMetadata() {
  return { title: (await getTranslations("settings"))("title") };
}

/** HU-E9-13: the Settings screen (the form renders its own heading); Volver returns to the space `?from=` names. */
export default async function SettingsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ from?: string }>;
}) {
  const [{ from }, spaces] = await Promise.all([searchParams, getSpaces()]);
  return (
    <div className="mx-auto max-w-[640px] py-4">
      <SettingsContainer backHref={spaceHomeHref(spaces, from)} />
    </div>
  );
}
