import { getTranslations } from "next-intl/server";
import { NotFoundScreen } from "@/shared/ui";

export async function generateMetadata() {
  return { title: (await getTranslations("notFound"))("title") };
}

/** N1: an address that matches no route. The (app) group's own `not-found` covers a space the person cannot open. */
export default function RootNotFound() {
  return <NotFoundScreen />;
}
