import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * Ruling P147: what a visitor reads instead of the form while sign-up is closed and they hold no invitation. N5: the
 * link to sign in keeps where the visitor was going (and the invitation, when there is one).
 */
export function SignUpClosedNotice({ signInHref = "/sign-in" }: { readonly signInHref?: string }) {
  const t = useTranslations("auth.signUp");
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold text-ink">{t("closedTitle")}</h1>
      <p className="text-muted">{t("closedBody")}</p>
      <Link href={signInHref} className="self-start font-semibold text-accent">
        {t("signIn")}
      </Link>
    </section>
  );
}
