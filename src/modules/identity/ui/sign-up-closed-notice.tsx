import Link from "next/link";
import { useTranslations } from "next-intl";

/** Ruling P147: what a visitor reads instead of the form while sign-up is closed and they hold no invitation. */
export function SignUpClosedNotice() {
  const t = useTranslations("auth.signUp");
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold text-ink">{t("closedTitle")}</h1>
      <p className="text-muted">{t("closedBody")}</p>
      <Link href="/sign-in" className="self-start font-semibold text-accent">
        {t("signIn")}
      </Link>
    </section>
  );
}
