import { notFound } from "next/navigation";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { CategoryGroupDto } from "@/shared/ui/api/dto";
import { getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { CategoryTree } from "./categories-screen";

/** HU-E9-04: the whole category tree of a space, archived groups and categories included, for the archived section. */
export const loadCategoryTree = async (api: Api, spaceId: string): Promise<Loaded<CategoryGroupDto[]>> => {
  const result = await loaded(
    api.GET("/api/v1/spaces/{spaceId}/categories", {
      params: { path: { spaceId }, query: { archived: "true" } },
    }),
  );
  return result.ok ? { ok: true, data: result.data.items } : result;
};

/** Server: the categories screen of one of the person's spaces, with the controls their role allows. */
export async function CategoryTreeContainer({ spaceId }: { readonly spaceId: string }) {
  const space = (await getSpaces()).find((s) => s.id === spaceId);
  if (!space) notFound();
  const result = await loadCategoryTree(await serverApi(), spaceId);
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  return <CategoryTree space={space} groups={result.data} />;
}
