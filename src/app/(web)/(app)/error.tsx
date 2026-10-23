"use client";

import { ErrorScreen } from "@/shared/ui";

/** Ruling P127: Next.js hides server error messages in production; the digest is the reference to quote. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-[420px] px-4">
      <ErrorScreen digest={error.digest} onRetry={reset} />
    </main>
  );
}
