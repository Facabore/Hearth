import { getTranslations } from "next-intl/server";
import { NewSpaceForm, newSpaceBackHref } from "@/modules/spaces/ui";
import { AppShellContainer } from "@/modules/spaces/ui/server";
import { getSpaces } from "@/shared/ui/api/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("spaces.new"))("title") };
}

/**
 * HU-E9-05: create a shared space (a name and a currency). `?from=` is the space the create link started from: the
 * shell around the form is that space's (N3) when it is one of hers. Volver returns to the screen the link started from
 * (`returnTo`); saving lands in the new space, not there. A layout cannot read the query, so the page wraps itself.
 */
export default routeScreen<Record<never, never>, { from?: string; returnTo?: string }>(
  async (_params, { from, returnTo }) => {
    const spaces = await getSpaces();
    return AppShellContainer({
      spaceId: null,
      from,
      children: (
        <div className="mx-auto max-w-[560px]">
          <NewSpaceForm backHref={newSpaceBackHref(spaces, from, returnTo)} />
        </div>
      ),
    });
  },
);
