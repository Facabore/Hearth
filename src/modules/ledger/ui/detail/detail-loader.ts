import type { Api } from "@/shared/ui/api/client";
import type { MemberDto, SpaceDto, TransactionDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { loaded, redirectToSignIn } from "@/shared/ui/api/server";
import type { Viewer } from "./transaction-actions";

export interface TransactionDetail {
  readonly tx: TransactionDto | null;
  readonly problem: Problem | null;
  readonly members: MemberDto[];
  readonly viewer: Viewer;
}

/**
 * Ruling P189: the transaction behind `?tx=`, and in a shared or direct space the members who name its parts. A
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
  },
): Promise<TransactionDetail> => {
  const path = { spaceId: input.spaceId, transactionId: input.transactionId };
  const [read, members] = await Promise.all([
    api
      .GET("/api/v1/spaces/{spaceId}/transactions/{transactionId}", { params: { path } })
      .catch((error: unknown) => ({ data: undefined, error, response: undefined })),
    input.space.kind === "PERSONAL"
      ? null
      : loaded(api.GET("/api/v1/spaces/{spaceId}/members", { params: { path: { spaceId: input.spaceId } } })),
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
  };
};
