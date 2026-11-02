import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import Link from "next/link";
import { useTranslations } from "use-intl";
import { Button, ProblemNotice, ScreenHeader } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { useApis } from "../api";
import { ProblemError } from "../read";
import { LOADER_OWNED } from "../reads";
import { useTitle } from "../title";

type Outcome = { kind: "verified" } | { kind: "problem"; problem: Problem };

/** A link without its token never reaches the API: it is the same broken link the API would refuse. */
const MISSING_TOKEN: Outcome = {
  kind: "problem",
  problem: { code: "InvalidVerificationLink", status: 422, requestId: null, errors: [], field: null },
};

/**
 * Issue #86, ruling P283: the link of a verification email confirms its token once per screen; confirming twice is ok,
 * so a reload changes nothing. A failure that may pass (the network, a 5xx) is thrown, so it is tried once more and
 * then shown as such; a refused token is the screen's own state.
 */
export const verifyEmailQuery = (api: Api, token: string) =>
  queryOptions<Outcome>({
    ...LOADER_OWNED,
    queryKey: ["verify-email", token],
    staleTime: Infinity,
    queryFn: async () => {
      if (token === "") return MISSING_TOKEN;
      try {
        const { error, response } = await api.POST("/api/v1/auth/verify-email", { body: { token } });
        if (response.ok) return { kind: "verified" };
        const problem = problemFrom(error, response);
        if (problem.status >= 500) throw new ProblemError(problem);
        return { kind: "problem", problem };
      } catch (error) {
        if (error instanceof ProblemError || error instanceof TypeError) throw error;
        return { kind: "problem", problem: problemFrom(error, undefined) };
      }
    },
  });

/** What the screen says once the API answered: the address is confirmed, or why the link did not work. */
export function VerifyEmailNotice({ outcome }: { readonly outcome: Outcome }) {
  const t = useTranslations("invitation.verify");
  return (
    <div className="flex flex-col gap-3">
      <ScreenHeader backHref="/" title={t("pageTitle")} />
      <section
        aria-labelledby="verify-email-title"
        className="flex flex-col gap-2 rounded-[20px] border border-line bg-surface p-3"
      >
        <h2
          id="verify-email-title"
          className="text-[22px] leading-7 font-semibold text-ink [overflow-wrap:anywhere]"
        >
          {outcome.kind === "verified" ? t("verified") : t("failed")}
        </h2>
        {outcome.kind === "verified" ? (
          <p className="text-[15px] leading-[22px] text-ink [overflow-wrap:anywhere]">{t("verifiedBody")}</p>
        ) : (
          <ProblemNotice problem={outcome.problem} />
        )}
      </section>
      <Button asChild size="lg">
        <Link href="/">{t("continue")}</Link>
      </Button>
    </div>
  );
}

const route = getRouteApi("/_open/verify-email");

/**
 * Issue #86: the screen a verification email opens, `/verify-email?token=…`, in the public frame. The session guard
 * sends a visitor to sign in first and back here with the token (`next`), as for any screen that is not open.
 */
export function VerifyEmailRoute() {
  const { token } = route.useSearch();
  const { sessionApi } = useApis();
  useTitle(useTranslations("invitation.verify")("pageTitle"));
  return <VerifyEmailNotice outcome={useSuspenseQuery(verifyEmailQuery(sessionApi, token)).data} />;
}
