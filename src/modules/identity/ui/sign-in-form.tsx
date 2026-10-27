"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, ProblemNotice, TextField } from "@/shared/ui";
import type { SignUpMode } from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import { PasswordField } from "./password-field";

export interface SignInFormProps {
  readonly next: string;
  readonly expired: boolean;
  readonly signUp: SignUpMode;
  /** The URL's invitation token, kept in the link to sign-up (ruling P147). */
  readonly invitation?: string;
  readonly onSubmit: (body: { email: string; password: string }) => void;
  readonly pending: boolean;
  readonly problem: Problem | null;
  readonly problemField: string | null;
}

const FORGOT_HELP = "si-forgot-help";

/**
 * HU-E9-01, the Main artboard: email, password, the main action and the way to sign up. Rulings: P143 and P146 hide
 * the sign-up link while sign-up is closed; P144 and P146 answer a forgotten password with an inline note (the
 * operator resets it); P146 keeps the email and refocuses an emptied password after a problem; P151 says why a
 * visitor came back.
 */
export function SignInForm({
  next,
  expired,
  signUp,
  invitation,
  onSubmit,
  pending,
  problem,
}: SignInFormProps) {
  const t = useTranslations("auth");
  const form = useRef<HTMLFormElement>(null);
  const [forgotOpen, setForgotOpen] = useState(false);

  useEffect(() => {
    if (!problem) return;
    const password = form.current?.elements.namedItem("password");
    if (password instanceof HTMLInputElement) {
      password.value = "";
      password.focus();
    }
  }, [problem]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSubmit({ email: String(data.get("email") ?? ""), password: String(data.get("password") ?? "") });
  };
  const query = [
    next === "/" ? null : `next=${encodeURIComponent(next)}`,
    invitation === undefined ? null : `invitation=${encodeURIComponent(invitation)}`,
  ].filter((part) => part !== null);
  const createAccount = query.length === 0 ? "/sign-up" : `/sign-up?${query.join("&")}`;
  return (
    <form ref={form} onSubmit={submit} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-ink">{t("signIn.title")}</h1>
        <p className="text-muted">{t("signIn.subtitle")}</p>
      </div>
      {expired ? (
        <p role="status" className="rounded-xl border border-line bg-surface p-3 text-sm text-ink">
          {t("sessionExpired")}
        </p>
      ) : null}
      <TextField
        id="si-email"
        name="email"
        type="email"
        label={t("email")}
        autoComplete="username"
        inputMode="email"
        required
      />
      <div className="flex flex-col gap-1">
        <PasswordField
          id="si-password"
          name="password"
          label={t("password")}
          autoComplete="current-password"
          required
        />
        <Button
          variant="ghost"
          className="self-start"
          aria-expanded={forgotOpen}
          aria-controls={FORGOT_HELP}
          onClick={() => setForgotOpen((open) => !open)}
        >
          {t("signIn.forgot")}
        </Button>
        <p id={FORGOT_HELP} hidden={!forgotOpen} className="text-sm text-muted">
          {t("signIn.forgotHelp")}
        </p>
      </div>
      {problem ? <ProblemNotice problem={problem} /> : null}
      <Button type="submit" size="lg" disabled={pending}>
        {t("signIn.submit")}
      </Button>
      {signUp === "open" ? (
        <Button asChild variant="secondary" size="lg">
          <Link href={createAccount}>{t("signIn.createAccount")}</Link>
        </Button>
      ) : null}
    </form>
  );
}
