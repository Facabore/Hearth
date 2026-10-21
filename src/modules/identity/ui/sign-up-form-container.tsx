"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";
import type { Locale } from "@/i18n/locale";
import { browserApi, type Api } from "@/shared/ui/api/client";
import { fieldOf, problemFrom, type Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { browserTimeZone } from "@/shared/ui/format/zones";
import { SignUpClosedNotice } from "./sign-up-closed-notice";
import { SignUpForm, type SignUpField } from "./sign-up-form";

const FIELDS = ["name", "email", "password"] as const;
const BY_CODE = {
  EmailTaken: "email",
  InvalidEmail: "email",
  PasswordTooShort: "password",
  InvalidPassword: "password",
} as const;

/** Ruling P157: the way back to sign in keeps where the visitor was going and the invitation they hold. */
const signInHrefOf = (next: string, invitation: string | undefined): string => {
  const query = [
    next === "/" ? null : `next=${encodeURIComponent(next)}`,
    invitation === undefined ? null : `invitation=${encodeURIComponent(invitation)}`,
  ].filter((part): part is string => part !== null);
  return query.length === 0 ? "/sign-in" : `/sign-in?${query.join("&")}`;
};

/**
 * HU-E9-01, HU-E1-14: signs up from the browser with its time zone and lands on the personal space. Rulings P142 and
 * P147: the body carries the screen's locale and the URL's invitation token; a `SignUpClosed` answer swaps the form
 * for the closed notice. Ruling P157: after the sign-up the route goes to `next`, which the page already made safe.
 */
export function SignUpFormContainer({
  next = "/",
  invitation,
  api: injected,
}: {
  /** Already made safe by the page (`safeNext`, ruling P157). */
  readonly next?: string;
  readonly invitation?: string;
  readonly api?: Api;
}) {
  const router = useRouter();
  const t = useTranslations("auth.signUp");
  const locale = useLocale() as Locale;
  const messageOf = useProblemMessage();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const submit = async (body: { name: string; email: string; password: string }) => {
    setPending(true);
    setProblem(null);
    try {
      const { error, response } = await api.POST("/api/v1/auth/sign-up", {
        body: {
          ...body,
          timezone: browserTimeZone(),
          locale,
          ...(invitation === undefined ? {} : { invitationToken: invitation }),
        },
      });
      if (response.ok) {
        router.replace(next);
        router.refresh();
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  if (problem?.code === "SignUpClosed") return <SignUpClosedNotice />;

  const where = problem ? fieldOf<SignUpField>(problem, BY_CODE, FIELDS) : "form";
  const fieldErrors: Partial<Record<SignUpField, ReactNode>> = {};
  if (problem && where !== "form") {
    const { message } = messageOf(problem);
    fieldErrors[where] =
      problem.code === "EmailTaken" ? (
        <>
          {message} <Link href="/sign-in">{t("signIn")}</Link>
        </>
      ) : (
        message
      );
  }

  return (
    <SignUpForm
      onSubmit={(body) => void submit(body)}
      pending={pending}
      fieldErrors={fieldErrors}
      problem={problem && where === "form" ? problem : null}
      signInHref={signInHrefOf(next, invitation)}
    />
  );
}
