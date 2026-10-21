import { getTranslations } from "next-intl/server";
import { NewSpaceForm, spaceHomeHref } from "@/modules/spaces/ui";
import { getSpaces } from "@/shared/ui/api/server";

export async function generateMetadata() {
  return { title: (await getTranslations("spaces.new"))("title") };
}

/** HU-E9-05: create a shared space (a name and a currency), inside the shell of the personal space. */
export default async function NewSpacePage({
  searchParams,
}: {
  readonly searchParams: Promise<{ from?: string }>;
}) {
  const [{ from }, spaces] = await Promise.all([searchParams, getSpaces()]);
  return (
    <div className="mx-auto max-w-[560px]">
      <NewSpaceForm backHref={spaceHomeHref(spaces, from)} />
    </div>
  );
}
