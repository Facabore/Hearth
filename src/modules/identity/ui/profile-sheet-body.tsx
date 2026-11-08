"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, type ReactNode } from "react";
import { localeCookie, type Locale } from "@/i18n/locale";
import { Avatar, Button, Icon, Sheet } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";

/**
 * HU-E9-01, the ProfileSheet artboard: only what belongs to the person and the app. Ruling P309: the space's accounts,
 * categories and members moved to the space's own settings (Ajustes de {space}, from the space switcher). It loads when
 * the avatar is first tapped, so the shell, which every route carries, holds only the avatar (ADR 0004).
 */
export function ProfileSheetBody({
  me,
  spaceId,
  api: injected,
  open,
  onOpenChange,
}: {
  readonly me: { readonly name: string; readonly email: string; readonly locale: Locale };
  readonly spaceId: string;
  readonly api?: Api | undefined;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("shell.profile");
  const router = useRouter();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
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
  // Board B1 · 05 (P292, P309): Ajustes in a card of its own, with ›.
  const card = "mb-3 flex flex-col divide-y divide-line rounded-2xl border border-line";
  const go = (href: string, icon: ReactNode, label: string, hint?: string) => (
    <Link
      href={href}
      className="flex min-h-14 items-center gap-3 px-3 py-2 text-ink"
      onClick={() => onOpenChange(false)}
    >
      {icon}
      <span className="flex flex-1 flex-col">
        {label}
        {hint ? <span className="text-sm text-muted">{hint}</span> : null}
      </span>
      <Icon name="chevronRight" size={20} />
    </Link>
  );
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={me.name}
      closeButton={false}
      leading={<Avatar name={me.name} size={48} tone="dark" />}
    >
      <p className="mb-4 text-sm [overflow-wrap:anywhere] text-muted">{me.email}</p>
      <div className={card}>
        {go(`/settings?from=${spaceId}`, <Icon name="sliders" />, t("settings"), t("settingsHint"))}
      </div>
      <Button variant="danger" size="lg" className="w-full" onClick={() => void signOut()}>
        <Icon name="signOut" />
        {t("signOut")}
      </Button>
    </Sheet>
  );
}
