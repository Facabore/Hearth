import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { ClaimPreviewDto, InvitationPreviewDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { getMe, outcomeOf, serverApi } from "@/shared/ui/api/server";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { serverZone } from "@/shared/ui/time/server-now";
import { InvitationCard } from "./invitation-card";

export type PreviewKind = "invitation" | "claim";
export type PreviewOf<K extends PreviewKind> = K extends "invitation"
  ? InvitationPreviewDto
  : ClaimPreviewDto;

export type LoadedPreview<K extends PreviewKind> =
  { kind: "found"; preview: PreviewOf<K> } | { kind: "missing" } | { kind: "problem"; problem: Problem };

/**
 * Ruling P156: the preview endpoints need no session, so a 401 is not expected; if one comes back anyway it is shown
 * as a problem, never as a redirect (an open page must not send anyone to the sign-in screen).
 */
export const loadPreview = async <K extends PreviewKind>(
  api: Api,
  input: { kind: K; token: string },
): Promise<LoadedPreview<K>> => {
  const params = { params: { path: { token: input.token } } };
  try {
    const result =
      input.kind === "invitation"
        ? await api.GET("/api/v1/invitations/{token}", params)
        : await api.GET("/api/v1/claims/{token}", params);
    const outcome = outcomeOf<PreviewOf<K>>(result as Parameters<typeof outcomeOf<PreviewOf<K>>>[0]);
    if (outcome.kind === "ok") return { kind: "found", preview: outcome.data };
    if (outcome.kind === "missing") return { kind: "missing" };
    if (outcome.kind === "problem") return { kind: "problem", problem: outcome.problem };
    return { kind: "problem", problem: problemFrom(undefined, result.response) };
  } catch (error) {
    return { kind: "problem", problem: problemFrom(error, undefined) };
  }
};

/**
 * HU-E9-05, ruling P157: the page of an invitation or a claim link. It reads the token's preview and, if there is one,
 * the session; dates use the person's formats and zone when signed in, else the built-in ones and the installation's
 * zone (ruling P182).
 */
export async function InvitationContainer({
  kind,
  token,
}: {
  readonly kind: PreviewKind;
  readonly token: string;
}) {
  const [api, me] = await Promise.all([serverApi(), getMe()]);
  const result = await loadPreview(api, { kind, token });
  if (result.kind === "problem") return <ProblemNotice problem={result.problem} />;
  return (
    <InvitationCard
      kind={kind}
      token={token}
      preview={result.kind === "found" ? result.preview : null}
      viewer={me ? { email: me.email } : null}
      formats={me?.preferences.effective ?? BUILT_IN_FORMATS}
      zone={me?.timezone ?? serverZone()}
    />
  );
}
