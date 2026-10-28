import { getTranslations } from "next-intl/server";
import { SettingsContainer } from "@/modules/identity/ui/server";
import { activeSpaceOf, spaceHomeHref, SpaceNameSection } from "@/modules/spaces/ui";
import { AppShellContainer } from "@/modules/spaces/ui/server";
import { getSpaces } from "@/shared/ui/api/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("settings"))("title") };
}

/**
 * HU-E9-13: the Settings screen (the form renders its own heading). `?from=` is the space the person came from: Volver
 * returns to its home and, when it is one of hers, the shell around the screen is that space's (N3). A layout cannot
 * read the query, so the page wraps itself in the shell. #167: the same space, the personal one without `?from=`, is
 * the one its managers rename here.
 */
export default routeScreen<Record<never, never>, { from?: string }>(async (_params, { from }) => {
  const spaces = await getSpaces();
  const space = activeSpaceOf(spaces, null, from)!;
  return AppShellContainer({
    spaceId: null,
    from,
    children: (
      <div className="mx-auto flex max-w-[640px] flex-col gap-3 py-3">
        {/* Called, so its read runs inside the screen and the document streams no skeleton first (#196). */}
        {await SettingsContainer({ backHref: spaceHomeHref(spaces, from) })}
        {/* Keyed by the space: another `?from=` starts the field afresh, its own rename's refresh does not. */}
        <SpaceNameSection key={space.id} space={space} />
      </div>
    ),
  });
});
