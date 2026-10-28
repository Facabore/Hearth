import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { CategoryTree } from "@/modules/categories/ui";
import { useApis } from "../api";
import { useViewer } from "../viewer";
import { categoriesQuery } from "../queries";
import { useTitle } from "../title";

const route = getRouteApi("/spaces/$spaceId/categories");

/**
 * HU-E9-04: the category tree of a space, archived groups and categories included, with the controls the viewer's role
 * allows. The tree keeps its own copy for its changes and takes a fresh read whenever the query refreshes.
 */
export function CategoriesRoute() {
  useTitle(useTranslations("categories")("title"));
  const { spaceId } = route.useParams();
  const { api } = useApis();
  const { space } = useViewer(spaceId);
  const groups = useSuspenseQuery(categoriesQuery(api, spaceId, "all")).data;
  return (
    <div className="mx-auto max-w-[720px] py-3">
      <CategoryTree space={space} groups={groups} />
    </div>
  );
}
