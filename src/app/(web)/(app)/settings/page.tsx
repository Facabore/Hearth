import { getTranslations } from "next-intl/server";
import { SettingsContainer } from "@/modules/identity/ui/server";
import { spaceHomeHref } from "@/modules/spaces/ui";
import { AppShellContainer } from "@/modules/spaces/ui/server";
import { getSpaces } from "@/shared/ui/api/server";

export async function generateMetadata() {
  return { title: (await getTranslations("settings"))("title") };
}

/**
 * HU-E9-13: the Settings screen (the form renders its own heading). `?from=` is the space the person came from: Volver
 * returns to its home and, when it is one of hers, the shell around the screen is that space's (N3). A layout cannot
 * read the query, so the page wraps itself in the shell.
 */
export default async function SettingsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ from?: string }>;
}) {
  const [{ from }, spaces] = await Promise.all([searchParams, getSpaces()]);
  return (
    <AppShellContainer spaceId={null} from={from}>
      <div className="mx-auto max-w-[640px] py-4">
        <SettingsContainer backHref={spaceHomeHref(spaces, from)} />
      </div>
    </AppShellContainer>
  );
}
