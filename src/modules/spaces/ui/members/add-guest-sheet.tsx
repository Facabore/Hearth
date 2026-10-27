"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button, ProblemNotice, Sheet, TextField } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { fieldOf, problemFrom, type Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";

/**
 * HU-E9-05, ruling P163, the AddGuest artboard: a guest is a member without an account, named by the person adding
 * them; the optional email is only remembered, nothing is sent to it.
 */
export function AddGuestSheet({
  open,
  onOpenChange,
  space,
  api: injected,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly space: Pick<SpaceDto, "id" | "name">;
  readonly api?: Api;
}) {
  const t = useTranslations("members");
  const router = useRouter();
  const problemMessage = useProblemMessage();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);

  const add = async () => {
    setPending(true);
    setProblem(null);
    try {
      const contactEmail = email.trim();
      const { error, response } = await api.POST("/api/v1/spaces/{spaceId}/guests", {
        params: { path: { spaceId: space.id } },
        body: { displayName: name.trim(), ...(contactEmail ? { contactEmail } : {}) },
      });
      if (response.ok) {
        onOpenChange(false);
        router.refresh();
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  // The hint shows the name as the list will show it, live, once something is typed (the AddGuest artboard).
  const typedName = name.trim();
  const nameHint = typedName
    ? t("guestSheet.nameHintNamed", { name: `${typedName} ${t("guestSuffix")}` })
    : t("guestSheet.nameHint");

  const where = problem
    ? fieldOf(
        problem,
        { MemberNameTaken: "displayName", InvalidMemberName: "displayName", InvalidEmail: "contactEmail" },
        ["displayName", "contactEmail"],
      )
    : null;
  const errorFor = (field: "displayName" | "contactEmail") =>
    problem && where === field ? problemMessage(problem).message : undefined;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("guestSheet.addTitle", { space: space.name })}
      description={t("guestSheet.intro", { space: space.name })}
      footer={
        <Button size="lg" disabled={pending} onClick={() => void add()}>
          {t("addGuest")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField
          id="guest-name"
          autoComplete="off"
          label={t("guestSheet.name")}
          hint={nameHint}
          value={name}
          error={errorFor("displayName")}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          id="guest-email"
          type="email"
          autoComplete="off"
          label={t("guestSheet.email")}
          hint={t("guestSheet.emailHint")}
          value={email}
          error={errorFor("contactEmail")}
          onChange={(event) => setEmail(event.target.value)}
        />
        {problem && where === "form" ? <ProblemNotice problem={problem} /> : null}
      </div>
    </Sheet>
  );
}
