"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import type { Api } from "@/shared/ui/api/client";
import type { TransactionDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { useToast } from "@/shared/ui/molecules/toast";
import { leaveSheet } from "./leave-sheet";

/** Ruling P194: a soft delete at once (D8), undone by a restore from the toast; never a confirmation dialog. */
export const useDeleteWithUndo = ({
  api,
  spaceId,
  tx,
  origin,
}: {
  readonly api: Api;
  readonly spaceId: string;
  readonly tx: TransactionDto;
  readonly origin: string;
}) => {
  const t = useTranslations("ledger.toast");
  const router = useRouter();
  const toast = useToast();
  const messageOf = useProblemMessage();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const restoring = useRef(false);
  const path = { spaceId, transactionId: tx.id };
  const undoFailed = (failure: Problem) =>
    toast.show({ tone: "alert", message: t("undoFailed", { message: messageOf(failure).message }) });

  const undo = async () => {
    if (restoring.current) return;
    restoring.current = true;
    try {
      const { error, response } = await api.POST(
        "/api/v1/spaces/{spaceId}/transactions/{transactionId}/restore",
        {
          params: { path },
        },
      );
      if (response.ok) {
        router.refresh();
        toast.show({ message: t(`restored.${tx.type}`) });
      } else undoFailed(problemFrom(error, response));
    } catch (error) {
      undoFailed(problemFrom(error, undefined));
    }
  };

  const remove = async () => {
    if (pending) return;
    setPending(true);
    setProblem(null);
    try {
      const { error, response } = await api.DELETE("/api/v1/spaces/{spaceId}/transactions/{transactionId}", {
        params: { path },
      });
      if (response.ok) {
        leaveSheet(router, origin, () => router.refresh());
        toast.show({
          message: t(`deleted.${tx.type}`),
          action: { label: t("undo"), onAction: () => void undo() },
        });
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  return { remove, pending, problem };
};
