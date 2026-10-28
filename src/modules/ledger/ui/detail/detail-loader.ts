import type { Api } from "@/shared/ui/api/client";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { problemFrom } from "@/shared/ui/api/problem";
import { loaded, redirectToSignIn } from "@/shared/ui/api/server";
import type { TransactionDetail } from "./transaction-detail";

export type { TransactionDetail };

/**
 * Ruling P189: the transaction behind `?tx=`, and in a shared or direct space the members who name its parts and the
 * viewer's personal accounts (they may always read their own; another member's account stays "Cuenta de Juan"). A
 * missing or deleted transaction is a problem for the sheet to show, never the not-found page that `loaded` renders
 * for a 404: the list stays under it.
 */
export const loadTransactionDetail = async (
  api: Api,
  input: {
    readonly spaceId: string;
    readonly transactionId: string;
    readonly space: SpaceDto;
    readonly meUserId: string;
    /** The viewer's personal space, whose accounts name their own payments in a shared space (issue #165). */
    readonly personalSpaceId?: string | undefined;
  },
): Promise<TransactionDetail> => {
  const path = { spaceId: input.spaceId, transactionId: input.transactionId };
  const shared = input.space.kind !== "PERSONAL";
  const [read, members, own] = await Promise.all([
    api
      .GET("/api/v1/spaces/{spaceId}/transactions/{transactionId}", { params: { path } })
      .catch((error: unknown) => ({ data: undefined, error, response: undefined })),
    shared
      ? loaded(api.GET("/api/v1/spaces/{spaceId}/members", { params: { path: { spaceId: input.spaceId } } }))
      : null,
    // Names only: a failed read leaves the private label, never a problem in the sheet.
    shared && input.personalSpaceId
      ? api
          .GET("/api/v1/spaces/{spaceId}/accounts", {
            params: { path: { spaceId: input.personalSpaceId }, query: { archived: "true" } },
          })
          .then((result) => result.data?.items ?? [])
          .catch(() => [])
      : [],
  ]);
  if (read.response?.status === 401) return redirectToSignIn();
  const tx = read.data ?? null;
  const items = members?.ok ? members.data.items : [];
  return {
    tx,
    problem: tx ? null : problemFrom(read.error, read.response),
    members: items,
    viewer: {
      userId: input.meUserId,
      role: input.space.role,
      memberId: items.find((m) => m.userId === input.meUserId)?.id ?? null,
    },
    ownAccountNames: Object.fromEntries(own.map((a) => [a.id, a.name])),
  };
};
