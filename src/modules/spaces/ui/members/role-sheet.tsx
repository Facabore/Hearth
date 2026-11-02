"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { Badge, Button, Icon, ProblemNotice, Sheet } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { MemberDto, SpaceDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import type { SpaceRole } from "./space-controls";

/** Ruling P272 overrides P164: Propietario is neither assigned nor changed here. */
const ROLES = ["ADMIN", "MEMBER", "VIEWER"] as const satisfies readonly SpaceRole[];
type AssignableRole = (typeof ROLES)[number];

/**
 * HU-E9-05, the board "Selector de rol del miembro": an OWNER changes a registered member's role among Administrador,
 * Miembro and Lector, in one radio list that marks the current role. Native radios keep the group's keyboard
 * behaviour (one tab stop, arrows move and choose) without code of their own.
 */
export function RoleSheet({
  open,
  onOpenChange,
  space,
  member,
  joined,
  api: injected,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly space: Pick<SpaceDto, "id" | "name">;
  readonly member: Pick<MemberDto, "id" | "displayName"> & { readonly role: AssignableRole };
  /** "Se unió el …", under the title. */
  readonly joined: string;
  readonly api?: Api;
}) {
  const t = useTranslations("members");
  const roles = useTranslations("shell.role");
  const router = useRouter();
  const ids = useId();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [role, setRole] = useState<AssignableRole>(member.role);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  const save = async () => {
    setPending(true);
    setProblem(null);
    try {
      const { error, response } = await api.PATCH("/api/v1/spaces/{spaceId}/members/{memberId}", {
        params: { path: { spaceId: space.id, memberId: member.id } },
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
      title={t("roleSheet.title", { name: member.displayName, space: space.name })}
      description={joined}
      footer={
        <Button size="lg" disabled={pending || role === member.role} onClick={() => void save()}>
          {t("roleSheet.save")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="sr-only">{t("roleSheet.label")}</legend>
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {ROLES.map((value) => (
              <label
                key={value}
                className="flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2 has-[:checked]:bg-accent-soft"
              >
                <input
                  type="radio"
                  name={`${ids}-role`}
                  value={value}
                  checked={role === value}
                  onChange={() => setRole(value)}
                  aria-labelledby={`${ids}-${value}-name`}
                  aria-describedby={`${ids}-${value}`}
                  className="size-5 shrink-0 accent-accent"
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span id={`${ids}-${value}-name`} className="font-semibold text-ink">
                    {roles(value)}
                  </span>
                  <span id={`${ids}-${value}`} className="text-sm text-muted">
                    {t(`roleDetail.${value}`)}
                  </span>
                </span>
                {value === member.role ? <Badge tone="accent">{t("roleSheet.current")}</Badge> : null}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="flex items-start gap-2 rounded-2xl bg-track p-3 text-sm text-ink">
          <Icon name="lock" size={20} className="shrink-0 text-muted" />
          {t("roleSheet.lock")}
        </p>
        {problem ? <ProblemNotice problem={problem} /> : null}
      </div>
    </Sheet>
  );
}
