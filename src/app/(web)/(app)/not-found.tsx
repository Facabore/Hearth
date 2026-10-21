import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const [shell, nav] = await Promise.all([getTranslations("shell"), getTranslations("shell.nav")]);
  return (
    <div className="mx-auto flex max-w-[420px] flex-col gap-4 px-4 py-8">
      <h1 className="text-xl font-semibold text-ink">{shell("notFound")}</h1>
      <Link href="/" className="font-semibold text-accent">
        {nav("home")}
      </Link>
    </div>
  );
}
