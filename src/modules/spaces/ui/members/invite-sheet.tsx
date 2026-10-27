"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { localDateIn } from "@/shared/kernel/time-zone";
import { Button, ChoiceGroup, CopyField, ProblemNotice, Sheet, TextField } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { CreatedInvitationDto, SpaceDto } from "@/shared/ui/api/dto";
import { fieldOf, problemFrom, type Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { formatDate, type Formats } from "@/shared/ui/format/formatters";

/** Nobody joins as OWNER: that role is changed from the members list. */
const ROLES = ["ADMIN", "MEMBER", "VIEWER"] as const;
type InviteRole = (typeof ROLES)[number];
type How = "link" | "email";

/**
 * HU-E9-05, ruling P162, the Invite artboard: an invitation is created only when the person presses the button, and
 * its URL comes back once (only its hash is stored, P155), so it lives in this sheet's state and nowhere else. An
 * email invitation shows its URL too when the API could not send the email (P144: Hearth sends no mail yet).
 */
export function InviteSheet({
  open,
  onOpenChange,
  space,
  formats,
  viewerZone,
  api: injected,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly space: Pick<SpaceDto, "id" | "name">;
  readonly formats: Formats;
  readonly viewerZone: string;
  readonly api?: Api;
}) {
  const t = useTranslations("members.inviteSheet");
  const roles = useTranslations("shell.role");
  const details = useTranslations("members.roleDetail");
  const router = useRouter();
  const problemMessage = useProblemMessage();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [how, setHow] = useState<How>("link");
  const [role, setRole] = useState<InviteRole>("MEMBER");
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<CreatedInvitationDto | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);

  const forget = () => {
    setResult(null);
    setProblem(null);
  };
  const create = async () => {
    setPending(true);
    forget();
    try {
      const { data, error, response } = await api.POST("/api/v1/spaces/{spaceId}/invitations", {
        params: { path: { spaceId: space.id } },
        body: how === "link" ? { kind: "LINK", role } : { kind: "EMAIL", email: email.trim(), role },
      });
      if (response.ok && data) {
        setResult(data);
        router.refresh();
      } else {
        setProblem(problemFrom(error, response));
      }
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  const where = problem ? fieldOf(problem, { InvalidEmail: "email" }, ["email"]) : null;
  const sentTo = result?.invitation.email ?? email.trim();

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("title", { space: space.name })}
      footer={
        <Button size="lg" disabled={pending || result !== null} onClick={() => void create()}>
          {how === "link" ? t("createLink") : t("send")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <ChoiceGroup
          label={t("how")}
          value={how}
          onValueChange={(next) => {
            setHow(next);
            forget();
          }}
          options={[
            { value: "link", label: t("link") },
            { value: "email", label: t("emailTab") },
          ]}
        />
        <div className="flex flex-col gap-2">
          <ChoiceGroup
            label={t("role")}
            layout="chips"
            value={role}
            onValueChange={(next) => {
              setRole(next);
              forget();
            }}
            options={ROLES.map((value) => ({
              value,
              label: (
                <span className="flex flex-col items-start py-1 text-left">
                  <span>{roles(value)}</span>
                  <span className="text-xs font-normal text-muted">{details(value)}</span>
                </span>
              ),
            }))}
          />
          <p className="text-sm text-muted">{t("ownerNote")}</p>
        </div>
        {how === "email" ? (
          <TextField
            id="invite-email"
            type="email"
            autoComplete="off"
            label={t("email")}
            hint={t("emailHint")}
            value={email}
            error={where === "email" && problem ? problemMessage(problem).message : undefined}
            onChange={(event) => {
              setEmail(event.target.value);
              setResult(null);
            }}
          />
        ) : null}
        {problem && where === "form" ? <ProblemNotice problem={problem} /> : null}
        {result ? (
          <div className="flex flex-col gap-2 rounded-2xl bg-accent-soft p-3">
            <p className="text-sm font-semibold text-ink">{t("linkReady")}</p>
            {result.invitation.kind === "EMAIL" ? (
              <p className="text-sm text-ink">
                {result.emailSent ? t("sent", { email: sentTo }) : t("notSent", { email: sentTo })}
              </p>
            ) : null}
            <CopyField
              id="invite-url"
              label={t("linkLabel")}
              value={result.url}
              note={t("linkNote", {
                role: roles(result.invitation.role),
                date: formatDate(localDateIn(new Date(result.invitation.expiresAt), viewerZone), formats),
              })}
            />
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
