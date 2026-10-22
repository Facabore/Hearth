import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { resolveLocale } from "@/i18n/locale";
import { getMe, getSpaces, redirectToSignIn } from "@/shared/ui/api/server";
import { AppShell } from "./app-shell";
import { activeSpaceOf } from "./space-helpers";

/** Server: an expired session goes to the sign-in screen with `next`; a space the person is not in is not found. */
export async function AppShellContainer({
  spaceId,
  from,
  children,
}: {
  readonly spaceId: string | null;
  /** N3: for a screen without a space in its URL, the space `?from=` names; only one of the person's own counts. */
  readonly from?: string | undefined;
  readonly children: ReactNode;
}) {
  const me = await getMe();
  if (!me) return redirectToSignIn();
  const spaces = await getSpaces();
  const activeSpace = activeSpaceOf(spaces, spaceId, from) ?? notFound();
  return (
    <AppShell
      me={{ name: me.name, email: me.email, locale: resolveLocale({ userLocale: me.locale }) }}
      spaces={spaces}
      activeSpace={activeSpace}
    >
      {children}
    </AppShell>
  );
}
