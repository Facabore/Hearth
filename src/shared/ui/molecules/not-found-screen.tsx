import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "../atoms/button";
import { Logo } from "../atoms/logo";

/**
 * N1: the page of an address that leads nowhere, for the app's root and for a space the person cannot open. It speaks
 * the person's language, wears the app's theme (it renders inside the root layout) and always has a way out.
 */
export function NotFoundScreen() {
  const t = useTranslations("notFound");
  const common = useTranslations("common");
  return (
    <main className="mx-auto flex min-h-dvh max-w-[420px] flex-col justify-center gap-3 px-4 py-6 max-[359px]:px-3">
      <Logo />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-ink">{t("title")}</h1>
        <p className="text-muted">{t("body")}</p>
      </div>
      <Button asChild size="lg">
        <Link href="/">{common("toStart")}</Link>
      </Button>
    </main>
  );
}
