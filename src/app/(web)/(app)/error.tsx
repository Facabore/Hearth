"use client";

import { useTranslations } from "next-intl";
import { Button, ProblemNotice } from "@/shared/ui";

/** Ruling P127: Next.js hides server error messages in production; the digest is the reference to quote. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("common");
  return (
    <div className="mx-auto flex max-w-[420px] flex-col gap-4 px-4 py-8">
      <ProblemNotice
        problem={{ code: "Unknown", status: 500, requestId: error.digest ?? null, errors: [], field: null }}
      />
      <Button onClick={reset}>{t("retry")}</Button>
    </div>
  );
}
