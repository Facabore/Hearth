"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { localeCookie, type Locale } from "@/i18n/locale";
import { Avatar, Button, Icon, Sheet } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";

/** HU-E9-01, the ProfileSheet artboard; Categories, Members and rules come with HU-E9-04, -05 and -14 (ruling P126). */
export function ProfileSheet({
  me,
  spaceId,
  api: injected,
}: {
  readonly me: { readonly name: string; readonly email: string; readonly locale: Locale };
  readonly spaceId: string;
  readonly api?: Api;
}) {
  const t = useTranslations("shell.profile");
  const router = useRouter();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [open, setOpen] = useState(false);
  const signOut = async () => {
    // Ruling P149: the sign-in screen reads the visitor cookie, so it keeps the language the person had.
    document.cookie = localeCookie(me.locale);
    try {
      await api.POST("/api/v1/auth/sign-out");
    } finally {
      router.replace("/sign-in");
      router.refresh();
    }
  };
  const row = "flex min-h-14 items-center gap-3 rounded-xl px-2 text-ink";
  return (
    <>
      <button
        type="button"
        aria-label={t("open", { name: me.name })}
        onClick={() => setOpen(true)}
        className="flex size-11 items-center justify-center rounded-full"
      >
        <Avatar name={me.name} />
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={me.name}>
        <p className="mb-4 text-sm text-muted">{me.email}</p>
        <Link href="/settings" className={row} onClick={() => setOpen(false)}>
          <Icon name="sliders" />
          <span className="flex flex-col">
            <span>{t("settings")}</span>
            <span className="text-sm text-muted">{t("settingsHint")}</span>
          </span>
        </Link>
        <Link href={`/spaces/${spaceId}/accounts`} className={row} onClick={() => setOpen(false)}>
          <Icon name="list" />
          {t("accounts")}
        </Link>
        <Button variant="danger" size="lg" className="mt-4" onClick={() => void signOut()}>
          <Icon name="signOut" />
          {t("signOut")}
        </Button>
      </Sheet>
    </>
  );
}
