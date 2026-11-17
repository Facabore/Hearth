"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button, ProblemNotice } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { FriendAvatar } from "./friend-avatar";
import type { FriendRequestDto, FriendRequestsDto } from "./friends";

/** The person a request is with: their name, and under it their @ when they still have one. */
function Who({ request, note }: { readonly request: FriendRequestDto; readonly note?: string }) {
  const under = [request.handle === null ? null : `@${request.handle}`, note].filter(Boolean).join(" · ");
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <FriendAvatar name={request.displayName} state="settled" />
      <span className="flex min-w-0 flex-col">
        <span className="font-medium [overflow-wrap:anywhere] text-ink">{request.displayName}</span>
        {under ? <span className="text-[13px] [overflow-wrap:anywhere] text-muted">{under}</span> : null}
      </span>
    </span>
  );
}

/**
 * Ruling P339 (board "Amigos · solicitudes y eliminar", S4): the requests over the friends. The ones the viewer
 * received come first, each with Aceptar, which opens the pair's direct space, and Rechazar, which closes it without
 * telling the sender; then the ones the viewer sent, as "Solicitud enviada" under the person's @. Either answer reads
 * Amigos and the requests again.
 */
export function FriendRequests({
  requests,
  api: injected,
}: {
  readonly requests: FriendRequestsDto;
  readonly api?: Api;
}) {
  const t = useTranslations("friends.requests");
  const router = useRouter();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const count = requests.incoming.length + requests.outgoing.length;
  if (count === 0) return null;

  const answer = async (request: FriendRequestDto, how: "accept" | "reject") => {
    setPending(request.id);
    setProblem(null);
    try {
      const params = { path: { requestId: request.id } };
      const { error, response } =
        how === "accept"
          ? await api.POST("/api/v1/me/friend-requests/{requestId}/accept", { params })
          : await api.POST("/api/v1/me/friend-requests/{requestId}/reject", { params });
      if (response.ok) router.refresh();
      else setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(null);
  };

  return (
    <section aria-labelledby="friend-requests-title" className="flex flex-col">
      <h2 id="friend-requests-title" className="text-[13px] font-semibold text-muted">
        {t("title", { count })}
      </h2>
      {problem ? <ProblemNotice problem={problem} /> : null}
      <ul className="divide-y divide-line">
        {requests.incoming.map((request) => (
          <li key={request.id} className="flex min-h-row-lg flex-wrap items-center gap-x-3 gap-y-2 py-2">
            <Who request={request} />
            <span className="ml-auto flex gap-2">
              <Button
                size="md"
                className="px-4"
                aria-label={t("acceptOf", { name: request.displayName })}
                disabled={pending === request.id}
                onClick={() => void answer(request, "accept")}
              >
                {t("accept")}
              </Button>
              <Button
                variant="secondary"
                size="md"
                className="px-4"
                aria-label={t("rejectOf", { name: request.displayName })}
                disabled={pending === request.id}
                onClick={() => void answer(request, "reject")}
              >
                {t("reject")}
              </Button>
            </span>
          </li>
        ))}
        {requests.outgoing.map((request) => (
          <li key={request.id} className="flex min-h-row-lg items-center py-2">
            <Who request={request} note={t("sent")} />
          </li>
        ))}
      </ul>
    </section>
  );
}
