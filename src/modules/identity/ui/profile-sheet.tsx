"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { Locale } from "@/i18n/locale";
import { Avatar } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { SpaceDto } from "@/shared/ui/api/dto";

/** The sheet's rows load on the first tap of the avatar: the shell, in every route, carries only the avatar. */
const ProfileSheetBody = dynamic(
  () => import("./profile-sheet-body").then((module) => module.ProfileSheetBody),
  {
    ssr: false,
  },
);

/** HU-E9-01: the person's avatar in the shell header, which opens the profile sheet. */
export function ProfileSheet({
  me,
  spaceId,
  spaceKind,
  api,
}: {
  readonly me: { readonly name: string; readonly email: string; readonly locale: Locale };
  readonly spaceId: string;
  readonly spaceKind: SpaceDto["kind"];
  readonly api?: Api;
}) {
  const t = useTranslations("shell.profile");
  const [open, setOpen] = useState(false);
  // Mounted from the first tap on, so the sheet can animate closed and opens again at once.
  const [opened, setOpened] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={t("open", { name: me.name })}
        onClick={() => {
          setOpened(true);
          setOpen(true);
        }}
        className="flex size-11 items-center justify-center rounded-full"
      >
        <Avatar name={me.name} tone="dark" />
      </button>
      {opened ? (
        <ProfileSheetBody
          me={me}
          spaceId={spaceId}
          spaceKind={spaceKind}
          api={api}
          open={open}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  );
}
