import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { ErrorScreen } from "@/shared/ui";
import dynamic from "./next/dynamic";
import { ProblemError } from "./read";

/**
 * N2: a screen whose load failed, with Reintentar; an API that did not answer says so. Retrying loads the screen again
 * (its guards, loaders and queries), not only the boundary, which alone would show the same failure. It is in the app
 * shell, so it shows with no network at all.
 */
export function AppError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const retry = () => {
    reset();
    void router.invalidate();
  };
  return (
    <main className="mx-auto max-w-[420px] px-4 max-[359px]:px-3">
      <ErrorScreen onRetry={retry} variant={error instanceof TypeError ? "connection" : "unexpected"} />
    </main>
  );
}

// The API answered, so the network is there: the notice and its icons load with it, not with the app shell.
const ProblemNotice = dynamic(() =>
  import("@/shared/ui/molecules/problem-notice").then((m) => m.ProblemNotice),
);

/** A screen inside the shell whose read the API refused shows the problem in place, as the Next.js containers do. */
export function ScreenError(props: ErrorComponentProps) {
  return props.error instanceof ProblemError ? (
    <ProblemNotice problem={props.error.problem} />
  ) : (
    <AppError {...props} />
  );
}
