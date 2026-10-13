import { POST as acceptInvitation } from "@/app/api/v1/invitations/[token]/accept/route";
import { POST as createInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/route";
import { POST as createSpace } from "@/app/api/v1/spaces/route";
import { call, type TestUser } from "./app";

/** Creates a shared space over HTTP with `owner` as its OWNER; returns its id. */
export const newSharedSpace = async (owner: TestUser, name = "Household"): Promise<string> => {
  const response = await call(createSpace, "POST", "/api/v1/spaces", {
    user: owner,
    body: { kind: "SHARED", name, currency: "COP" },
  });
  if (response.status !== 201) throw new Error(`space creation failed with status ${response.status}`);
  return ((await response.json()) as { id: string }).id;
};

/** The same user acting in another space, for helpers that address `user.spaceId`. */
export const actingIn = (user: TestUser, spaceId: string): TestUser => ({ ...user, spaceId });

/** The token at the end of an invitation URL (`<origin>/invitations/<token>`). */
export const tokenOf = (url: string): string => new URL(url).pathname.split("/").at(-1)!;

/** Creates a link invitation over HTTP as `owner`; returns its token. */
export const inviteByLink = async (
  owner: TestUser,
  spaceId: string,
  role: "ADMIN" | "MEMBER" | "VIEWER",
): Promise<string> => {
  const response = await call(createInvitation, "POST", `/api/v1/spaces/${spaceId}/invitations`, {
    user: owner,
    params: { spaceId },
    body: { kind: "LINK", role },
  });
  if (response.status !== 201) throw new Error(`invitation failed with status ${response.status}`);
  return tokenOf(((await response.json()) as { url: string }).url);
};

/** `member` joins the space through a link invitation created by `owner` with `role`. */
export const joinAs = async (
  owner: TestUser,
  spaceId: string,
  member: TestUser,
  role: "ADMIN" | "MEMBER" | "VIEWER",
): Promise<void> => {
  const token = await inviteByLink(owner, spaceId, role);
  const response = await call(acceptInvitation, "POST", `/api/v1/invitations/${token}/accept`, {
    user: member,
    params: { token },
  });
  if (response.status !== 200) throw new Error(`joining failed with status ${response.status}`);
};
