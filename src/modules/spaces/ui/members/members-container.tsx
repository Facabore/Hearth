import { notFound } from "next/navigation";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { InvitationDto, MemberDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { MembersScreen } from "./members-screen";
import { controlsFor } from "./space-controls";

/**
 * HU-E9-05: the current members of a space, in join order, and, only for someone who may invite, its pending
 * invitations (ruling P155; `null` for everyone else, who could not read them).
 */
export const loadMembers = async (
  api: Api,
  input: { spaceId: string; canInvite: boolean },
): Promise<Loaded<{ members: MemberDto[]; invitations: InvitationDto[] | null }>> => {
  const path = { params: { path: { spaceId: input.spaceId } } };
  const [members, invitations] = await Promise.all([
    loaded(api.GET("/api/v1/spaces/{spaceId}/members", path)),
    input.canInvite ? loaded(api.GET("/api/v1/spaces/{spaceId}/invitations", path)) : null,
  ]);
  if (!members.ok) return members;
  if (invitations && !invitations.ok) return invitations;
  return {
    ok: true,
    data: { members: members.data.items, invitations: invitations ? invitations.data.items : null },
  };
};

/** Server: the members screen of a shared or direct space; a personal space has none (ruling P159). */
export async function MembersContainer({ spaceId }: { readonly spaceId: string }) {
  const [me, spaces] = await Promise.all([getMe(), getSpaces()]);
  const space = spaces.find((s) => s.id === spaceId);
  if (!space || space.kind === "PERSONAL") notFound();
  const result = await loadMembers(await serverApi(), {
    spaceId,
    canInvite: controlsFor(space.role, space.kind).invite,
  });
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  return (
    <MembersScreen
      space={space}
      members={result.data.members}
      meUserId={me!.id}
      invitations={result.data.invitations}
      formats={me!.preferences.effective}
      viewerZone={me!.timezone}
    />
  );
}
