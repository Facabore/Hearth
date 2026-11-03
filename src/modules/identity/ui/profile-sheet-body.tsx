"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, type ReactNode } from "react";
import { localeCookie, type Locale } from "@/i18n/locale";
import { Avatar, Button, Icon, Sheet, SymbolIcon } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { SpaceDto } from "@/shared/ui/api/dto";

/**
 * HU-E9-01, the ProfileSheet artboard; the Categories entry is HU-E9-04 and rules come with HU-E9-14 (ruling P126); the
 * Members entry, outside the personal space, is HU-E9-05 (ruling P160). It loads when the avatar is first tapped, so
 * the shell, which every route carries, holds only the avatar (ADR 0004).
 */
export function ProfileSheetBody({
  me,
  spaceId,
  spaceKind,
  api: injected,
  open,
  onOpenChange,
}: {
  readonly me: { readonly name: string; readonly email: string; readonly locale: Locale };
  readonly spaceId: string;
  readonly spaceKind: SpaceDto["kind"];
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
  // Board B1 · 05 (P292): Ajustes in a card of its own, then Cuentas, Categorías and Miembros in one card, each with ›.
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
    <Sheet open={open} onOpenChange={onOpenChange} title={me.name}>
      <div className="mb-4 flex items-center gap-3">
        <Avatar name={me.name} size={48} tone="dark" />
        <p className="min-w-0 text-sm [overflow-wrap:anywhere] text-muted">{me.email}</p>
      </div>
      <div className={card}>
        {go(`/settings?from=${spaceId}`, <Icon name="sliders" />, t("settings"), t("settingsHint"))}
      </div>
      <div className={card}>
        {go(`/spaces/${spaceId}/accounts`, <Icon name="list" />, t("accounts"))}
        {go(`/spaces/${spaceId}/categories`, <SymbolIcon name="tag" />, t("categories"))}
        {spaceKind !== "PERSONAL"
          ? go(`/spaces/${spaceId}/members`, <Icon name="userPlus" />, t("members"))
          : null}
      </div>
      <Button variant="danger" size="lg" className="w-full" onClick={() => void signOut()}>
        <Icon name="signOut" />
        {t("signOut")}
      </Button>
    </Sheet>
  );
}
