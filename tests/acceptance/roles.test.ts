import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as addGuest } from "@/app/api/v1/spaces/[spaceId]/guests/route";
import { PATCH as changeRole } from "@/app/api/v1/spaces/[spaceId]/members/[memberId]/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { GET as getSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import { joinAs, newSharedSpace } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** HU-E1-05 Background: "Household" with OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi and the guest Pedro. */
interface Team {
  readonly spaceId: string;
  readonly ana: TestUser;
  readonly juan: TestUser;
  readonly luis: TestUser;
  readonly sofi: TestUser;
  readonly pedroId: string;
}

/** `[status, null]` for a success, `[status, code]` for a problem. */
const outcome = async (pending: Promise<Response>): Promise<[number, string | null]> => {
  const response = await pending;
  if (response.status >= 400) return problemOf(response);
  return [response.status, null];
};
const team = async (): Promise<Team> => {
  const ana = await registerUser("Ana");
  const juan = await registerUser("Juan");
  const luis = await registerUser("Luis");
  const sofi = await registerUser("Sofi");
  const spaceId = await newSharedSpace(ana);
  await joinAs(ana, spaceId, juan, "ADMIN");
  await joinAs(ana, spaceId, luis, "MEMBER");
  await joinAs(ana, spaceId, sofi, "VIEWER");
  const pedro = await call(addGuest, "POST", `/api/v1/spaces/${spaceId}/guests`, {
    user: luis,
    params: { spaceId },
    body: { displayName: "Pedro" },
  });
  return { spaceId, ana, juan, luis, sofi, pedroId: ((await pedro.json()) as { id: string }).id };
};
const path = (t: Team, resource: string) => `/api/v1/spaces/${t.spaceId}/${resource}`;
const memberIdOf = async (t: Team, name: string) => {
  const response = await call(listMembers, "GET", path(t, "members"), {
    user: t.ana,
    params: { spaceId: t.spaceId },
  });
  const { items } = (await response.json()) as { items: { id: string; displayName: string }[] };
  return items.find((m) => m.displayName === name)!.id;
};
const setRole = (t: Team, user: TestUser, memberId: string, role: string) =>
  call(changeRole, "PATCH", path(t, `members/${memberId}`), {
    user,
    params: { spaceId: t.spaceId, memberId },
    body: { role },
  });

describe("role changes over HTTP (HU-E1-05)", () => {
  let t: Team;
  beforeAll(async () => {
    t = await team();
  });

  it("refuses role escalation, guest roles, unknown members and unknown roles (Review Focus 3, 5)", async () => {
    expect(await outcome(setRole(t, t.juan, await memberIdOf(t, "Juan"), "OWNER"))).toEqual([
      403,
      "InsufficientRole",
    ]);
    expect(await outcome(setRole(t, t.luis, await memberIdOf(t, "Sofi"), "ADMIN"))).toEqual([
      403,
      "InsufficientRole",
    ]);
    expect(await outcome(setRole(t, t.ana, t.pedroId, "MEMBER"))).toEqual([409, "GuestHasNoRole"]);
    expect(await outcome(setRole(t, t.ana, "not-a-uuid", "ADMIN"))).toEqual([404, "MemberNotFound"]);
    expect(await outcome(setRole(t, t.ana, await memberIdOf(t, "Luis"), "SUPERUSER"))).toEqual([
      422,
      "ValidationFailed",
    ]);
  });

  it("refuses to demote the only OWNER", async () => {
    expect(await outcome(setRole(t, t.ana, await memberIdOf(t, "Ana"), "ADMIN"))).toEqual([
      409,
      "LastOwnerRequired",
    ]);
  });
});

describe("owner changes a member's role (HU-E1-05)", () => {
  it("makes Luis an ADMIN, which Luis then sees in the space", async () => {
    const t = await team();
    const response = await setRole(t, t.ana, await memberIdOf(t, "Luis"), "ADMIN");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ displayName: "Luis", kind: "USER", role: "ADMIN" });
    const seen = await call(getSpace, "GET", `/api/v1/spaces/${t.spaceId}`, {
      user: t.luis,
      params: { spaceId: t.spaceId },
    });
    expect((await seen.json()).role).toBe("ADMIN");
  });
});
