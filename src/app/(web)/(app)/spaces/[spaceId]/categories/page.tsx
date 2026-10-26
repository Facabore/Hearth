import { getTranslations } from "next-intl/server";
import { CategoryTreeContainer } from "@/modules/categories/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("categories"))("title") };
}

/** HU-E9-04: the category tree of a space, with the controls the viewer's role allows. */
export default async function CategoriesPage({ params }: { readonly params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;
  return (
    <div className="mx-auto max-w-[720px] py-4">
      <CategoryTreeContainer spaceId={spaceId} />
    </div>
  );
}
