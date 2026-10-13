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
