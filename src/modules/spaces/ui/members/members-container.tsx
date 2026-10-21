import { notFound } from "next/navigation";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { MemberDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { MembersScreen } from "./members-screen";

/** HU-E9-05: the current members of a space, in join order. */
export const loadMembers = async (
  api: Api,
  input: { spaceId: string },
): Promise<Loaded<{ members: MemberDto[] }>> => {
  const members = await loaded(
    api.GET("/api/v1/spaces/{spaceId}/members", { params: { path: { spaceId: input.spaceId } } }),
  );
  return members.ok ? { ok: true, data: { members: members.data.items } } : members;
};

/** Server: the members screen of a shared or direct space; a personal space has none (ruling P159). */
export async function MembersContainer({ spaceId }: { readonly spaceId: string }) {
  const [me, spaces] = await Promise.all([getMe(), getSpaces()]);
  const space = spaces.find((s) => s.id === spaceId);
  if (!space || space.kind === "PERSONAL") notFound();
  const result = await loadMembers(await serverApi(), { spaceId });
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  return (
    <MembersScreen
      space={space}
      members={result.data.members}
      meUserId={me!.id}
      formats={me!.preferences.effective}
      viewerZone={me!.timezone}
    />
  );
}
