"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";
import { localeCookie, type Locale } from "@/i18n/locale";
import { Avatar, Button, Icon, Sheet } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import { friendLinkOf, shareLink } from "@/shared/ui/share-link";

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
  readonly me: {
    readonly name: string;
    readonly email: string;
    readonly locale: Locale;
    /** Ruling P343: the person's @, which everyone has; absent only while it is not known yet. */
    readonly handle?: string;
  };
  readonly spaceId: string;
  readonly api?: Api | undefined;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("shell.profile");
  const router = useRouter();
  const [shared, setShared] = useState<"copied" | "copyFailed" | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  // The body stays mounted while closed, so each opening starts from Compartir, not from the last copy's answer.
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setShared(null);
  }
  const handle = me.handle;
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
  // Ruling P343: the person's own friend link, as Agregar amigo shares it.
  const share = async (handle: string) => {
    const outcome = await shareLink({
      url: `${window.location.origin}${friendLinkOf(handle)}`,
      text: t("shareText"),
    });
    if (outcome === "copied" || outcome === "copyFailed") setShared(outcome);
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
      {handle ? (
        // Board "Perfil · tu @ para compartir · P343": who the person is, to share or to change.
        <div className="mb-3 flex flex-col gap-1 rounded-[14px] bg-accent-soft px-4 py-3.5">
          <p className="font-semibold [overflow-wrap:anywhere] text-accent">{t("you", { handle })}</p>
          <p className="text-sm text-ink">{t("handleNote")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="compact" className="px-4" onClick={() => void share(handle)}>
              {shared === "copied" ? (
                <>
                  <Icon name="check" size={18} />
                  {t("copied")}
                </>
              ) : (
                t("share")
              )}
            </Button>
            <Link
              href={`/settings?from=${spaceId}#settings-handle`}
              className="inline-flex min-h-11 items-center px-3 text-sm font-semibold text-accent"
              onClick={() => onOpenChange(false)}
            >
              {t("changeHandle")}
            </Link>
          </div>
          <p role="status" className={shared === "copyFailed" ? "text-sm text-ink" : "sr-only"}>
            {shared ? t(shared) : null}
          </p>
        </div>
      ) : null}
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
