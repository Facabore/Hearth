import { getTranslations } from "next-intl/server";
import { NotFoundScreen } from "@/shared/ui";

export async function generateMetadata() {
  return { title: (await getTranslations("notFound"))("title") };
}

/** N1: a space or a page the person cannot open, in the same look as the root's. */
export default function AppNotFound() {
  return <NotFoundScreen />;
}
