import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as getSignUpMode, POST as signUp } from "@/app/api/v1/auth/sign-up/route";
import { POST as acceptClaim } from "@/app/api/v1/claims/[token]/accept/route";
import { POST as acceptInvitation } from "@/app/api/v1/invitations/[token]/accept/route";
import { GET as me } from "@/app/api/v1/me/route";
import { POST as createInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { cryptoInvitationTokens } from "@/modules/spaces/infrastructure/crypto-invitation-tokens";
import {
  apiRequest,
  call,
  cookieHeader,
  problemOf,
  startTestApp,
  uniqueEmail,
  type TestUser,
} from "../support/app";
import { addGuest, household } from "../support/ledger";
import { claimLink, inviteByLink, tokenOf } from "../support/spaces";

const register = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  signUp(apiRequest("POST", "/api/v1/auth/sign-up", { body, headers }));
const person = (extra: Record<string, unknown> = {}) => ({
  name: "Marta",
  email: uniqueEmail("marta"),
  password: "123456789012",
  ...extra,
});
/** The status and problem of a refusal, without its per-request id, to compare two refusals. */
const problemBody = async (response: Response) => {
  const problem = await response.json();
  delete problem.requestId;
  return [response.status, problem];
};

let app: Container;
/** Each suite owns its container: the closing suite replaces its first one, so only the last is left to end. */
const stopApp = async () => {
  setContainerForTests(undefined);
  await app.pool.end();
};

describe("the visitor's language at sign-up (ruling P142)", () => {
  beforeAll(() => {
    app = startTestApp();
  });
  afterAll(stopApp);

  it("keeps the language the visitor used: GET /me answers en", async () => {
    const response = await register(person({ locale: "en" }));
    expect(response.status).toBe(201);
    expect((await response.json()).user.locale).toBe("en");
    const profile = await me(
      apiRequest("GET", "/api/v1/me", { headers: { cookie: cookieHeader(response) } }),
    );
    expect((await profile.json()).locale).toBe("en");
  });

  it("answers es when the sign-up names no language", async () => {
    const response = await register(person());
    expect(response.status).toBe(201);
    expect((await response.json()).user.locale).toBe("es");
  });

  it.each(["fr", "EN", 5, null, ""])("never refuses a sign-up over the language %j", async (locale) => {
    const response = await register(person({ locale }));
    expect(response.status).toBe(201);
    expect((await response.json()).user.locale).toBe("es");
  });
});

describe("closing sign-up (ruling P143)", () => {
  let ana: TestUser;
  let spaceId: string;
  let linkToken: string;
  let revokedToken: string;
  let juanaInvitation: string;
  let pedroClaim: string;
  const count = async (table: string): Promise<number> =>
    (await app.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  const emailInvitation = async (email: string): Promise<string> => {
    const created = await call(createInvitation, "POST", `/api/v1/spaces/${spaceId}/invitations`, {
      user: ana,
      params: { spaceId },
      body: { kind: "EMAIL", email, role: "VIEWER" },
    });
    return tokenOf((await created.json()).url);
  };

  beforeAll(async () => {
    // Accounts and invitations exist before the instance closes, as in the recommended order.
    app = startTestApp();
    const h = await household();
    ana = h.ana;
    spaceId = h.spaceId;
    linkToken = await inviteByLink(ana, spaceId, "MEMBER");
    revokedToken = await inviteByLink(ana, spaceId, "MEMBER");
    juanaInvitation = await emailInvitation("Juana@Example.com");
    pedroClaim = (await claimLink(ana, spaceId, await addGuest(h, "Pedro"))).token;
    const revoked = await app.pool.query(
      "UPDATE space_invitations SET status = 'REVOKED', revoked_at = now() WHERE token_hash = $1",
      [cryptoInvitationTokens.hash(revokedToken)],
    );
    expect(revoked.rowCount).toBe(1);
    await app.pool.end();
    app = startTestApp({}, { HEARTH_SIGN_UP: "closed" });
  });
  afterAll(stopApp);

  it("tells the sign-up and sign-in screens that sign-up is closed, without a session", async () => {
    const response = await getSignUpMode(apiRequest("GET", "/api/v1/auth/sign-up"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signUp: "closed" });
  });

  it("refuses a visitor without an invitation with 403 SignUpClosed and creates nothing", async () => {
    const body = person();
    const [users, spaces] = [await count('"user"'), await count("spaces")];
    const response = await register(body);
    expect(await problemOf(response)).toEqual([403, "SignUpClosed"]);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await count('"user"')).toBe(users);
    expect(await count("spaces")).toBe(spaces);
  });

  it("answers every unusable token like a missing one, so tokens are not revealed", async () => {
    const missing = await problemBody(await register(person()));
    for (const invitationToken of ["unknown-token", revokedToken, "x".repeat(513), 42, ""]) {
      expect(await problemBody(await register(person({ invitationToken })))).toEqual(missing);
    }
    expect(missing[1]).toMatchObject({ code: "SignUpClosed", status: 403 });
  });

  it("signs up an invited visitor, who then accepts the invitation as usual (HU-E1-07)", async () => {
    const body = person({ name: "Juana", email: "juana@example.com", invitationToken: juanaInvitation });
    const response = await register(body);
    expect(response.status).toBe(201);
    const juana: TestUser = {
      cookie: cookieHeader(response),
      userId: (await response.json()).user.id,
      spaceId,
      email: body.email,
    };
    // Signing up used nothing up: the invitation is still pending until the client accepts it.
    const pending = await app.pool.query("SELECT status FROM space_invitations WHERE token_hash = $1", [
      cryptoInvitationTokens.hash(juanaInvitation),
    ]);
    expect(pending.rows[0].status).toBe("PENDING");
    const accepted = await call(acceptInvitation, "POST", `/api/v1/invitations/${juanaInvitation}/accept`, {
      user: juana,
      params: { token: juanaInvitation },
    });
    expect(accepted.status).toBe(200);
    const members = await call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, {
      user: ana,
      params: { spaceId },
    });
    const { items } = (await members.json()) as { items: { userId: string | null }[] };
    expect(items.map((m) => m.userId)).toContain(juana.userId);
  });

  it("binds an email invitation to its address, spelling aside", async () => {
    // Created while closed: Ana is signed in, so this only needs her session.
    const token = await emailInvitation("luisa@example.com");
    const intruder = person({ email: "intruder@example.com", invitationToken: token });
    expect(await problemOf(await register(intruder))).toEqual([403, "SignUpClosed"]);
    const luisa = person({ email: "  LUISA@example.com", invitationToken: token });
    expect((await register(luisa)).status).toBe(201);
  });

  it("signs up a visitor holding a link invitation, whichever address they use", async () => {
    expect((await register(person({ invitationToken: linkToken }))).status).toBe(201);
    expect((await register(person({ invitationToken: linkToken }))).status).toBe(201);
  });

  it("signs up a visitor holding a claim link, who then takes the guest's place", async () => {
    const response = await register(person({ name: "Pedro", invitationToken: pedroClaim }));
    expect(response.status).toBe(201);
    const pedro: TestUser = {
      cookie: cookieHeader(response),
      userId: (await response.json()).user.id,
      spaceId,
      email: "",
    };
    const claimed = await call(acceptClaim, "POST", `/api/v1/claims/${pedroClaim}/accept`, {
      user: pedro,
      params: { token: pedroClaim },
    });
    expect(claimed.status).toBe(200);
  });

  it("counts a closed refusal as an attempt of that address", async () => {
    const throttled = startTestApp(
      { authLimits: { signInPerEmail: 100, signInPerIp: 100, signUpPerIp: 2 } },
      { HEARTH_SIGN_UP: "closed" },
    );
    try {
      const from = { "x-forwarded-for": "203.0.113.9" };
      const statuses = [];
      for (let attempt = 0; attempt < 3; attempt++) statuses.push((await register(person(), from)).status);
      expect(statuses).toEqual([403, 403, 429]);
    } finally {
      await throttled.pool.end();
      setContainerForTests(app);
    }
  });
});

describe("an open installation (ruling P143)", () => {
  beforeAll(() => {
    app = startTestApp();
  });
  afterAll(stopApp);

  it("says so, and ignores an invitation token it does not need", async () => {
    const response = await getSignUpMode(apiRequest("GET", "/api/v1/auth/sign-up"));
    expect(await response.json()).toEqual({ signUp: "open" });
    expect((await register(person({ invitationToken: "unknown-token" }))).status).toBe(201);
  });
});
