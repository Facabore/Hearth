"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button, Icon, ProblemNotice, Sheet, VisuallyHidden } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { AccountDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";

interface ActionProps {
  readonly spaceId: string;
  readonly account: Pick<AccountDto, "id" | "name">;
  readonly api?: Api;
}

type Action = "archive" | "restore";

/** One call, then the Server Components read again; a refusal comes back as a problem. */
const useAccountAction = (action: Action, { spaceId, account, api: injected }: ActionProps) => {
  const router = useRouter();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const run = async (): Promise<boolean> => {
    setPending(true);
    setProblem(null);
    try {
      const params = { params: { path: { spaceId, accountId: account.id } } };
      const { error, response } =
        action === "archive"
          ? await api.POST("/api/v1/spaces/{spaceId}/accounts/{accountId}/archive", params)
          : await api.POST("/api/v1/spaces/{spaceId}/accounts/{accountId}/restore", params);
      if (response.ok) {
        router.refresh();
        return true;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    } finally {
      setPending(false);
    }
    return false;
  };
  return { run, pending, problem };
};

/** HU-E9-03: archive from a confirmation sheet; the history stays and restore brings it back (ruling P131). */
export function ArchiveAccountButton(props: ActionProps) {
  const t = useTranslations("accounts.archive");
  const [open, setOpen] = useState(false);
  const { run, pending, problem } = useAccountAction("archive", props);
  return (
    <>
      <Button variant="ghost" size="icon" onClick={() => setOpen(true)}>
        <Icon name="archive" />
        <VisuallyHidden>{t("open", { name: props.account.name })}</VisuallyHidden>
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t("title", { name: props.account.name })}
        description={t("explain")}
        footer={
          <Button
            variant="danger"
            size="lg"
            disabled={pending}
            onClick={() => void run().then((done) => done && setOpen(false))}
          >
            {t("confirm")}
          </Button>
        }
      >
        {problem ? <ProblemNotice problem={problem} /> : null}
      </Sheet>
    </>
  );
}

/**
 * Issue 169: a personal space with no active account creates its starter accounts in one call; the endpoint skips
 * every name the space already holds, so pressing it twice creates nothing more.
 */
export function StarterAccountsButton({
  spaceId,
  api: injected,
}: {
  readonly spaceId: string;
  readonly api?: Api;
}) {
  const t = useTranslations("accounts.empty");
  const router = useRouter();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const run = async () => {
    setPending(true);
    setProblem(null);
    try {
      const { error, response } = await api.POST("/api/v1/spaces/{spaceId}/accounts/starter", {
        params: { path: { spaceId } },
      });
      if (response.ok) router.refresh();
      else setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="secondary" disabled={pending} onClick={() => void run()}>
        <Icon name="plus" size={20} />
        {t("starter")}
      </Button>
      {problem ? <ProblemNotice problem={problem} /> : null}
    </div>
  );
}

/** HU-E9-03, Task 2's endpoint: an archived account takes movements again. */
export function RestoreAccountButton(props: ActionProps) {
  const t = useTranslations("accounts");
  const { run, pending, problem } = useAccountAction("restore", props);
  return (
    <div className="flex flex-col items-end">
      <Button
        variant="ghost"
        size="compact"
        disabled={pending}
        aria-label={t("restore", { name: props.account.name })}
        onClick={() => void run()}
      >
        {t("restore", { name: "" }).trim()}
      </Button>
      {problem ? <ProblemNotice problem={problem} /> : null}
    </div>
  );
}
