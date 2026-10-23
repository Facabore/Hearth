"use client";

import { ErrorScreen } from "@/shared/ui";

/** N2: the invitation and claim pages keep their frame (the layout's logo and language) around a failure. */
export default function OpenError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen digest={error.digest} onRetry={reset} />;
}
