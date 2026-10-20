"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button, ProblemNotice, TextField } from "@/shared/ui";
import type { Problem } from "@/shared/ui/api/problem";
import { PasswordField } from "./password-field";

export type SignUpField = "name" | "email" | "password";

export interface SignUpFormProps {
  readonly onSubmit: (body: { name: string; email: string; password: string }) => void;
  readonly pending: boolean;
  /** A message under its field (ruling P118). */
  readonly fieldErrors: Readonly<Partial<Record<SignUpField, ReactNode>>>;
  /** A problem that names no field. */
  readonly problem: Problem | null;
}

/**
 * HU-E9-01, the SignUp artboard: name, email, password and its confirmation; the personal space is created by the
 * API. Ruling P147: a confirmation that differs sends nothing, says so under it and takes the focus; it is never
 * part of the body.
 */
export function SignUpForm({ onSubmit, pending, fieldErrors, problem }: SignUpFormProps) {
  const t = useTranslations("auth");
  const [mismatch, setMismatch] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");
    if (password !== String(data.get("confirmPassword") ?? "")) {
      setMismatch(true);
      const confirm = form.elements.namedItem("confirmPassword");
      if (confirm instanceof HTMLInputElement) confirm.focus();
      return;
    }
    setMismatch(false);
    onSubmit({
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      password,
    });
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-ink">{t("signUp.title")}</h1>
        <p className="text-muted">{t("signUp.subtitle")}</p>
      </div>
      <TextField
        id="su-name"
        name="name"
        label={t("signUp.name")}
        autoComplete="name"
        required
        error={fieldErrors.name}
      />
      <TextField
        id="su-email"
        name="email"
        type="email"
        label={t("email")}
        autoComplete="username"
        inputMode="email"
        required
        error={fieldErrors.email}
      />
      <PasswordField
        id="su-password"
        name="password"
        label={t("password")}
        hint={t("signUp.passwordHint")}
        autoComplete="new-password"
        required
        error={fieldErrors.password}
      />
      <PasswordField
        id="su-confirm-password"
        name="confirmPassword"
        label={t("signUp.confirmPassword")}
        autoComplete="new-password"
        required
        error={mismatch ? t("signUp.passwordMismatch") : undefined}
        onChange={() => setMismatch(false)}
      />
      {problem ? <ProblemNotice problem={problem} /> : null}
      <Button type="submit" size="lg" disabled={pending}>
        {t("signUp.submit")}
      </Button>
      <p className="text-center text-sm text-muted">
        {t("signUp.haveAccount")}{" "}
        <Link href="/sign-in" className="font-semibold text-accent">
          {t("signUp.signIn")}
        </Link>
      </p>
    </form>
  );
}
