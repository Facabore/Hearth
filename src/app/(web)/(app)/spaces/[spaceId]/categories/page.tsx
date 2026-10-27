import { getTranslations } from "next-intl/server";
import { CategoryTreeContainer } from "@/modules/categories/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("categories"))("title") };
}

/** HU-E9-04: the category tree of a space, with the controls the viewer's role allows. */
export default routeScreen<{ spaceId: string }>(async ({ spaceId }) => (
  <div className="mx-auto max-w-[720px] py-3">{await CategoryTreeContainer({ spaceId })}</div>
));
