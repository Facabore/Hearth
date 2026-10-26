"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { Api } from "@/shared/ui/api/client";
import type { InvitationDto, MemberDto, MoneyDto, SpaceDto } from "@/shared/ui/api/dto";
import { formatDate, type Formats } from "@/shared/ui/format/formatters";
import { localDateIn } from "@/shared/kernel/time-zone";
import { Button, Icon, ScreenHeader } from "@/shared/ui";
import { AddGuestSheet } from "./add-guest-sheet";
import { GuestSheet } from "./guest-sheet";
import { InviteSheet } from "./invite-sheet";
import { memberLabel } from "./member-label";
import { MemberRow } from "./member-row";
import { PendingInvitations } from "./pending-invitations";
import { RoleSheet } from "./role-sheet";
import { controlsFor, type SpaceRole } from "./space-controls";
import { SpaceNameSection } from "../space-name-section";

/** HU-E9-05, the Main artboard as `/spaces/{spaceId}/members`: the members, and the controls the viewer's role allows. */
export function MembersScreen({
  space,
  members,
  meUserId,
  invitations = null,
  balances = {},
  openInvite = false,
  formats,
  viewerZone,
  api,
}: {
  readonly space: SpaceDto;
  readonly members: readonly MemberDto[];
  readonly meUserId: string;
  /** The pending invitations; `null` when the viewer may not invite (ruling P155). */
  readonly invitations?: readonly InvitationDto[] | null;
  /** Every member's net balance by member id (a missing one is settled up). */
  readonly balances?: Readonly<Record<string, MoneyDto>>;
  /** N10: `?invite=1` (Invitar on the home) opens the invite sheet at once, for someone who may invite. */
  readonly openInvite?: boolean;
  readonly formats: Formats;
  readonly viewerZone: string;
  readonly api?: Api;
}) {
  const t = useTranslations("members");
  const roles = useTranslations("shell.role");
  const router = useRouter();
  const [inviting, setInviting] = useState(() => openInvite && controlsFor(space.role, space.kind).invite);
  const [addingGuest, setAddingGuest] = useState(false);
  const [guest, setGuest] = useState<MemberDto | null>(null);
  const [editing, setEditing] = useState<(MemberDto & { role: SpaceRole }) | null>(null);
  const controls = controlsFor(space.role, space.kind);
  const policy =
    space.periodPolicy.kind === "MONTHLY"
      ? t("policy.MONTHLY", { day: space.periodPolicy.day })
      : t("policy.SEMI_MONTHLY", { day1: space.periodPolicy.day1, day2: space.periodPolicy.day2 });

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="flex flex-col">
        <ScreenHeader
          backHref={`/spaces/${space.id}`}
          title={t("title")}
          subtitle={t("subtitle", { space: space.name, currency: space.currency, policy })}
        />
        {controls.invite || controls.addGuest ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {controls.invite ? (
              <Button onClick={() => setInviting(true)}>
                <Icon name="link" size={20} />
                {t("invite")}
              </Button>
            ) : null}
            {controls.addGuest ? (
              <Button variant="secondary" onClick={() => setAddingGuest(true)}>
                <Icon name="userPlus" size={20} />
                {t("addGuest")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {space.kind === "DIRECT" ? (
        <p className="rounded-2xl bg-track p-3 text-sm text-ink">{t("directNote", { space: space.name })}</p>
      ) : !controls.invite && !controls.addGuest ? (
        <p className="rounded-2xl bg-track p-3 text-sm text-ink">
          {t("readOnlyNote", { space: space.name, role: space.role ? roles(space.role) : "" })}
        </p>
      ) : null}
      {/* #176: an OWNER or ADMIN renames the space here too, not only in Ajustes; the section hides itself otherwise. */}
      <SpaceNameSection key={space.id} space={space} api={api} />
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
                onOptions={
                  member.kind === "GUEST" && (controls.claimLinks || controls.removeGuests)
                    ? () => setGuest(member)
                    : undefined
                }
              />
            );
          })}
        </ul>
      </section>
      {invitations ? (
        <PendingInvitations
          spaceId={space.id}
          invitations={invitations}
          formats={formats}
          viewerZone={viewerZone}
          api={api}
        />
      ) : null}
      {inviting ? (
        <InviteSheet
          open
          onOpenChange={(open) => {
            setInviting(open);
            // The address dropped its `?invite=` as the sheet closed: a reload does not reopen it.
            if (!open && openInvite) router.replace(`/spaces/${space.id}/members`);
          }}
          space={space}
          formats={formats}
          viewerZone={viewerZone}
          api={api}
        />
      ) : null}
      {addingGuest ? <AddGuestSheet open onOpenChange={setAddingGuest} space={space} api={api} /> : null}
      {guest ? (
        <GuestSheet
          open
          onOpenChange={(open) => {
            if (!open) setGuest(null);
          }}
          space={space}
          guest={guest}
          label={memberLabel(guest, meUserId, t)}
          net={balances[guest.id] ?? { amount: "0", currency: space.currency }}
          controls={controls}
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
