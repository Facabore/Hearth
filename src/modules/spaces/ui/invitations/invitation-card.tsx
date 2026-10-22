"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { localeCookie, type Locale } from "@/i18n/locale";
import { localDateIn } from "@/shared/kernel/time-zone";
import { Avatar, Button, ProblemNotice } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { ClaimPreviewDto, InvitationPreviewDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { formatDate, type Formats } from "@/shared/ui/format/formatters";
import { pageStateOf } from "./invitation-state";

type Kind = "invitation" | "claim";

/** The accept button names the space: a long name wraps inside the button instead of widening the page. */
const LONG_NAME = "h-auto min-h-14 py-3 text-center [overflow-wrap:anywhere]";

/**
 * HU-E9-05, ruling P165, the InvitePage artboard: the page of an invitation or a claim link, for a visitor and for
 * someone already signed in. The preview carries no email (ruling P156), so the other-account state names only the
 * account the person is signed in with. A visitor goes through sign-up or sign-in with `next` back to this page.
 */
export function InvitationCard({
  kind,
  token,
  preview,
  viewer,
  formats,
  zone,
  api: injected,
}: {
  readonly kind: Kind;
  readonly token: string;
  /** `null` when the token names nothing. */
  readonly preview: InvitationPreviewDto | ClaimPreviewDto | null;
  readonly viewer: { readonly email: string } | null;
  readonly formats: Formats;
  readonly zone: string;
  readonly api?: Api;
}) {
  const t = useTranslations("invitation");
  const errors = useTranslations("errors");
  const common = useTranslations("common");
  const roles = useTranslations("shell.role");
  const router = useRouter();
  const locale = useLocale() as Locale;
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [mismatch, setMismatch] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);

  const claim = kind === "claim";
  const state = mismatch ? "otherAccount" : pageStateOf(preview?.status ?? null, viewer !== null);
  const back = `/${claim ? "claims" : "invitations"}/${encodeURIComponent(token)}`;
  const signUpHref = `/sign-up?invitation=${encodeURIComponent(token)}&next=${encodeURIComponent(back)}`;
  const signInHref = `/sign-in?next=${encodeURIComponent(back)}&invitation=${encodeURIComponent(token)}`;
  const space = preview?.spaceName ?? "";
  const name = preview?.invitedBy ?? t("someone");
  // Null once the place is no longer a guest (claimed, removed): the sentence then leaves out "como <name>".
  const guest = preview && "guestName" in preview ? preview.guestName : null;

  const accept = async () => {
    setPending(true);
    setProblem(null);
    try {
      const params = { params: { path: { token } } };
      const { data, error, response } = claim
        ? await api.POST("/api/v1/claims/{token}/accept", params)
        : await api.POST("/api/v1/invitations/{token}/accept", params);
      if (response.ok && data) {
        // Stays pending: the page is on its way to the space, which confirms the join once (U6).
        router.replace(`/spaces/${data.id}?joined=1`);
        router.refresh();
        return;
      }
      const failure = problemFrom(error, response);
      if (failure.code === "InvitationEmailMismatch") setMismatch(true);
      else setProblem(failure);
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  const switchAccount = async () => {
    setPending(true);
    // U8 (ruling P149): the sign-in screen reads the visitor cookie, so it keeps the language the person had.
    document.cookie = localeCookie(locale);
    try {
      await api.POST("/api/v1/auth/sign-out");
    } catch {
      // The sign-in screen is the way out whether or not the call went through.
    } finally {
      router.replace(signInHref);
      router.refresh();
    }
  };

  const tile = preview ? <Avatar name={preview.spaceName} size={52} /> : null;

  if (state === "visitor" || state === "signedIn") {
    const facts: Array<readonly [string, string]> = [];
    if (preview && "role" in preview) facts.push([t("role"), roles(preview.role)]);
    if (preview)
      facts.push([t("expires"), formatDate(localDateIn(new Date(preview.expiresAt), zone), formats)]);
    const kicker = claim
      ? preview?.invitedBy
        ? t("claim.kicker", { name })
        : t("claim.kickerAnonymous")
      : preview?.invitedBy
        ? t("kicker", { name })
        : t("kickerAnonymous");
    const title = claim && guest !== null ? t("claim.title", { space, guest }) : space;
    const body =
      state === "visitor"
        ? claim
          ? guest === null
            ? t("claim.bodyNoGuest", { space })
            : t("claim.body", { space, guest })
          : t("body", { space })
        : claim
          ? t("claim.signedInBody", { space })
          : t("signedInBody", { space, email: viewer?.email ?? "" });
    return (
      <div className="flex flex-col gap-5">
        <section
          aria-labelledby="invitation-title"
          className="flex flex-col gap-4 rounded-[20px] border border-line bg-surface p-5"
        >
          <div className="flex items-center gap-3">
            {tile}
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-sm text-muted [overflow-wrap:anywhere]">{kicker}</p>
              <h1
                id="invitation-title"
                className="min-w-0 text-[22px] leading-7 font-semibold text-ink [overflow-wrap:anywhere]"
              >
                {title}
              </h1>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-2.5">
            {facts.map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5 rounded-xl bg-bg px-3 py-2.5">
                <dt className="text-[13px] text-muted">{label}</dt>
                <dd className="font-semibold text-ink tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[15px] leading-[22px] text-ink [overflow-wrap:anywhere]">{body}</p>
        </section>
        <div className="flex flex-col gap-2.5">
          {state === "visitor" ? (
            <>
              <Button asChild size="lg">
                <Link href={signUpHref}>{claim ? t("claim.signUp") : t("signUp")}</Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link href={signInHref}>{t("signIn")}</Link>
              </Button>
              <p className="text-center text-[13px] leading-[18px] text-muted">
                {claim ? t("claim.note") : t("note")}
              </p>
            </>
          ) : (
            <>
              <Button size="lg" className={LONG_NAME} disabled={pending} onClick={() => void accept()}>
                {claim ? t("claim.accept", { space }) : t("accept", { space })}
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link href="/">{common("notNow")}</Link>
              </Button>
              {problem ? <ProblemNotice problem={problem} /> : null}
            </>
          )}
        </div>
      </div>
    );
  }

  if (state === "otherAccount") {
    return (
      <div className="flex flex-col gap-5">
        <section
          aria-labelledby="invitation-title"
          className="flex flex-col gap-4 rounded-[20px] border border-line bg-surface p-5"
        >
          <div className="flex items-center gap-3">
            {tile}
            <h1
              id="invitation-title"
              className="min-w-0 text-[22px] leading-7 font-semibold text-ink [overflow-wrap:anywhere]"
            >
              {space}
            </h1>
          </div>
          <p
            role="alert"
            className="rounded-[14px] border border-danger p-3 text-sm text-danger [overflow-wrap:anywhere]"
          >
            {t("otherAccount", { email: viewer?.email ?? "" })}
          </p>
          <p className="text-[15px] leading-[22px] text-ink [overflow-wrap:anywhere]">
            {t("otherAccountBody")}
          </p>
        </section>
        <div className="flex flex-col gap-2.5">
          <Button size="lg" disabled={pending} onClick={() => void switchAccount()}>
            {t("switchAccount")}
          </Button>
          <Button asChild variant="secondary" size="lg">
            <Link href="/">{common("notNow")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const closed = {
    expired: { message: t("expired", { name }), body: t("expiredBody") },
    revoked: { message: t("revoked"), body: t("revokedBody", { name }) },
    used: {
      message: errors(claim ? "GuestAlreadyClaimed" : "InvitationAlreadyUsed"),
      body: t("revokedBody", { name }),
    },
    missing: { message: errors("InvitationNotFound"), body: null },
  }[state];
  return (
    <div className="flex flex-col gap-5">
      <section
        aria-labelledby="invitation-title"
        className="flex flex-col gap-4 rounded-[20px] border border-line bg-surface p-5"
      >
        <div className="flex items-center gap-3">
          {tile}
          <h1
            id="invitation-title"
            className="min-w-0 text-[22px] leading-7 font-semibold text-ink [overflow-wrap:anywhere]"
          >
            {preview ? space : t("missingTitle")}
          </h1>
        </div>
        <p
          role="alert"
          className="rounded-[14px] border border-danger p-3 text-sm text-danger [overflow-wrap:anywhere]"
        >
          {closed.message}
        </p>
        {closed.body ? (
          <p className="text-[15px] leading-[22px] text-ink [overflow-wrap:anywhere]">{closed.body}</p>
        ) : null}
      </section>
      <Button asChild size="lg">
        <Link href="/">{common("goHome")}</Link>
      </Button>
    </div>
  );
}
