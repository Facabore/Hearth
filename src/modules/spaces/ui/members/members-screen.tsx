"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { Api } from "@/shared/ui/api/client";
import type { MemberDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatDate, type Formats } from "@/shared/ui/format/formatters";
import { localDateIn } from "@/shared/kernel/time-zone";
import { Button, Icon } from "@/shared/ui";
import { InviteSheet } from "./invite-sheet";
import { memberLabel } from "./member-label";
import { MemberRow } from "./member-row";
import { RoleSheet } from "./role-sheet";
import { controlsFor, type SpaceRole } from "./space-controls";

/** HU-E9-05, the Main artboard as `/spaces/{spaceId}/members`: the members, and the controls the viewer's role allows. */
export function MembersScreen({
  space,
  members,
  meUserId,
  formats,
  viewerZone,
  api,
}: {
  readonly space: SpaceDto;
  readonly members: readonly MemberDto[];
  readonly meUserId: string;
  readonly formats: Formats;
  readonly viewerZone: string;
  readonly api?: Api;
}) {
  const t = useTranslations("members");
  const roles = useTranslations("shell.role");
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<(MemberDto & { role: SpaceRole }) | null>(null);
  const controls = controlsFor(space.role, space.kind);
  const policy =
    space.periodPolicy.kind === "MONTHLY"
      ? t("policy.MONTHLY", { day: space.periodPolicy.day })
      : t("policy.SEMI_MONTHLY", { day1: space.periodPolicy.day1, day2: space.periodPolicy.day2 });

  return (
    <div className="flex flex-col gap-4 pb-4">
      <header className="flex flex-col">
        <h1 className="text-2xl font-semibold text-ink">{t("title")}</h1>
        <p className="text-sm text-muted">
          {t("subtitle", { space: space.name, currency: space.currency, policy })}
        </p>
        {controls.invite ? (
          <Button className="mt-3 self-start" onClick={() => setInviting(true)}>
            <Icon name="link" size={20} />
            {t("invite")}
          </Button>
        ) : null}
      </header>
      {space.kind === "DIRECT" ? (
        <p className="rounded-2xl bg-track p-3 text-sm text-ink">{t("directNote", { space: space.name })}</p>
      ) : !controls.invite && !controls.addGuest ? (
        <p className="rounded-2xl bg-track p-3 text-sm text-ink">
          {t("readOnlyNote", { space: space.name, role: space.role ? roles(space.role) : "" })}
        </p>
      ) : null}
      <section aria-labelledby="members-count" className="flex flex-col gap-1.5">
        <h2 id="members-count" className="text-sm font-semibold text-muted">
          {t("count", { count: members.length })}
        </h2>
        <ul className="divide-y divide-line rounded-2xl bg-surface px-4">
          {members.map((member) => {
            const role = member.role;
            const editable = controls.changeRoles && role !== null && member.userId !== meUserId;
            return (
              <MemberRow
                key={member.id}
                member={member}
                label={memberLabel(member, meUserId, t)}
                detail={
                  member.kind === "GUEST"
                    ? t("guestDetail")
                    : t("joined", {
                        date: formatDate(localDateIn(new Date(member.joinedAt), viewerZone), formats),
                      })
                }
                roleText={role === null ? t("noRole") : roles(role)}
                onRole={editable ? () => setEditing({ ...member, role }) : undefined}
              />
            );
          })}
        </ul>
      </section>
      {inviting ? (
        <InviteSheet
          open
          onOpenChange={setInviting}
          space={space}
          formats={formats}
          viewerZone={viewerZone}
          api={api}
        />
      ) : null}
      {editing ? (
        <RoleSheet
          key={editing.id}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          spaceId={space.id}
          member={editing}
          api={api}
        />
      ) : null}
    </div>
  );
}
