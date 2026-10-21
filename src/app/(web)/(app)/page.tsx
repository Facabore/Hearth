import { redirect } from "next/navigation";
import { personalSpaceOf } from "@/modules/spaces/ui";
import { getMe, getSpaces, redirectToSignIn } from "@/shared/ui/api/server";

/** Ruling P125: "/" opens the signed-in person's personal space. */
export default async function RootPage() {
  if (!(await getMe())) return redirectToSignIn();
  redirect(`/spaces/${personalSpaceOf(await getSpaces()).id}`);
}
