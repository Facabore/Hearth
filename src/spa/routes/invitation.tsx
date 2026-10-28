import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { InvitationCard } from "@/modules/spaces/ui/screens";
import type { Api } from "@/shared/ui/api/client";
import type { ClaimPreviewDto, InvitationPreviewDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { outcomeOf } from "@/shared/ui/api/readers";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { ProblemNotice } from "@/shared/ui";
import { serverZone } from "@/shared/ui/time/server-now";
import { useApis } from "../api";
import { meQuery } from "../queries";
import { LOADER_OWNED, moduleKeys } from "../reads";
import { useTitle } from "../title";

type Kind = "invitation" | "claim";
type Preview =
  | { kind: "found"; preview: InvitationPreviewDto | ClaimPreviewDto }
  | { kind: "missing" }
  | { kind: "problem"; problem: Problem };

/**
 * Ruling P156: a token's preview needs no session. A missing token is the card's own "invalid" state, never the
 * not-found screen, and a 401 is a problem to show, never a redirect: an open page sends nobody to sign in.
 */
export const previewQuery = (api: Api, kind: Kind, token: string) =>
  queryOptions<Preview>({
    ...LOADER_OWNED,
    queryKey: moduleKeys.preview(kind, token),
    queryFn: async () => {
      try {
        const params = { params: { path: { token } } };
        const result =
          kind === "invitation"
            ? await api.GET("/api/v1/invitations/{token}", params)
            : await api.GET("/api/v1/claims/{token}", params);
        const outcome = outcomeOf(
          result as { data?: InvitationPreviewDto; error?: unknown; response: Response },
        );
        if (outcome.kind === "ok") return { kind: "found", preview: outcome.data };
        if (outcome.kind === "missing") return { kind: "missing" };
        return { kind: "problem", problem: problemFrom(result.error, result.response) };
      } catch (error) {
        return { kind: "problem", problem: problemFrom(error, undefined) };
      }
    },
  });

/**
 * HU-E9-05, ruling P157: an invitation or claim link, open to anyone. Dates use the person's formats and zone when
 * signed in; without a profile, the built-in formats and the installation's default zone (P182), since the SPA reads
 * no server environment.
 */
function TokenScreen({ kind, token }: { readonly kind: Kind; readonly token: string }) {
  const { sessionApi } = useApis();
  const result = useSuspenseQuery(previewQuery(sessionApi, kind, token)).data;
  const me = useSuspenseQuery(meQuery(sessionApi)).data;
  if (result.kind === "problem") return <ProblemNotice problem={result.problem} />;
  return (
    <InvitationCard
      kind={kind}
      token={token}
      preview={result.kind === "found" ? result.preview : null}
      viewer={me ? { email: me.email } : null}
      formats={me?.preferences.effective ?? BUILT_IN_FORMATS}
      zone={me?.timezone ?? serverZone({})}
    />
  );
}

const invitation = getRouteApi("/_open/invitations/$token");
const claim = getRouteApi("/_open/claims/$token");

export function InvitationRoute() {
  useTitle(useTranslations("invitation")("pageTitle"));
  return <TokenScreen kind="invitation" token={invitation.useParams().token} />;
}

export function ClaimRoute() {
  useTitle(useTranslations("invitation.claim")("pageTitle"));
  return <TokenScreen kind="claim" token={claim.useParams().token} />;
}
