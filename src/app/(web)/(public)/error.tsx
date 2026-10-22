"use client";

import { ErrorScreen } from "@/shared/ui";

/** N2: the sign-in and sign-up screens keep their frame (the layout's logo and language) around a failure. */
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen digest={error.digest} onRetry={reset} />;
}
