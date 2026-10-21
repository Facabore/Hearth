"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Button, ChoiceGroup, ProblemNotice, Sheet } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { MemberDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import type { SpaceRole } from "./space-controls";

const ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const satisfies readonly SpaceRole[];

/** HU-E9-05, ruling P164: an OWNER changes a registered member's role; the API keeps at least one OWNER. */
export function RoleSheet({
  open,
  onOpenChange,
  spaceId,
  member,
  api: injected,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly spaceId: string;
  readonly member: Pick<MemberDto, "id" | "displayName"> & { readonly role: SpaceRole };
  readonly api?: Api;
}) {
  const t = useTranslations("members");
  const roles = useTranslations("shell.role");
  const router = useRouter();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [role, setRole] = useState<SpaceRole>(member.role);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const save = async () => {
    setPending(true);
    setProblem(null);
    try {
      const { error, response } = await api.PATCH("/api/v1/spaces/{spaceId}/members/{memberId}", {
        params: { path: { spaceId, memberId: member.id } },
        body: { role },
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

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("roleSheet.title", { name: member.displayName })}
      footer={
        <Button size="lg" disabled={pending || role === member.role} onClick={() => void save()}>
          {t("roleSheet.save")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <ChoiceGroup
          label={t("roleSheet.label")}
          layout="chips"
          value={role}
          onValueChange={setRole}
          options={ROLES.map((value) => ({
            value,
            label: (
              <span className="flex flex-col items-start py-1 text-left">
                <span>{roles(value)}</span>
                <span className="text-xs font-normal text-muted">{t(`roleDetail.${value}`)}</span>
              </span>
            ),
          }))}
        />
        {problem ? <ProblemNotice problem={problem} /> : null}
      </div>
    </Sheet>
  );
}
