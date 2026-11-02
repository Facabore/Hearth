import { afterAll, describe, expect, it } from "vitest";
import { POST as verifyEmail } from "@/app/api/v1/auth/verify-email/route";
import { POST as acceptInvitation } from "@/app/api/v1/invitations/[token]/accept/route";
import { POST as createInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { setContainerForTests, type Container } from "@/composition/container";
import type { MailMessage, Mailer } from "@/shared/infrastructure/email/smtp-mailer";
import { call, registerUser, startTestApp, uniqueEmail, type TestUser } from "../support/app";
import { inviteByLink, newSharedSpace, tokenOf } from "../support/spaces";

/** Issue #86, ruling P282: a mailer stands for a configured SMTP server, which turns verification on. */
const mails: MailMessage[] = [];
const mailer: Mailer = {
  send: async (message) => {
    mails.push(message);
    return true;
  },
};

let app: Container | undefined;
const withApp = async (options: Parameters<typeof startTestApp>[0]) => {
  setContainerForTests(undefined);
  await app?.pool.end();
  app = startTestApp(options);
};
afterAll(async () => {
  setContainerForTests(undefined);
  await app?.pool.end();
});

const mailsTo = (address: string) => mails.filter((m) => m.to === address.toLowerCase());
const invite = async (owner: TestUser, spaceId: string, email: string) => {
  const response = await call(createInvitation, "POST", `/api/v1/spaces/${spaceId}/invitations`, {
    user: owner,
    params: { spaceId },
    body: { kind: "EMAIL", email, role: "MEMBER" },
  });
  return tokenOf(((await response.json()) as { url: string }).url);
};
const accept = (user: TestUser, token: string) =>
  call(acceptInvitation, "POST", `/api/v1/invitations/${token}/accept`, { user, params: { token } });
const verify = (token: string) => call(verifyEmail, "POST", "/api/v1/auth/verify-email", { body: { token } });
const problem = async (response: Response) => {
  const body = (await response.json()) as { code: string };
  return { status: response.status, code: body.code };
};
const memberIds = async (owner: TestUser, spaceId: string) => {
  const response = await call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, {
    user: owner,
    params: { spaceId },
  });
  return ((await response.json()) as { items: { userId: string | null }[] }).items.map((m) => m.userId);
};
/** The token of the verification link in a message: `<BETTER_AUTH_URL>/verify-email?token=<token>`. */
const verificationTokenIn = (message: MailMessage) => {
  const link = message.text.match(/http:\/\/localhost:3000\/verify-email\?token=[^\s]+/)?.[0];
  if (!link) throw new Error("no verification link in the message");
  return new URL(link).searchParams.get("token")!;
};

/** Ana's Household invites Juan's address, and Juan signs up with it: his address is not confirmed yet. */
const invitedJuan = async () => {
  const ana = await registerUser("Ana");
  const spaceId = await newSharedSpace(ana);
  const email = uniqueEmail("juan");
  const token = await invite(ana, spaceId, email);
  const juan = await registerUser("Juan", email);
  return { ana, spaceId, token, juan };
};

describe("email verification with SMTP configured (issue #86, ruling P282)", () => {
  it("sends a new account a link that confirms its address", async () => {
    await withApp({ mailer });
    const juan = await registerUser("Juan");
    const [sent, ...more] = mailsTo(juan.email);
    expect(more).toEqual([]);
    expect(sent!.subject).toBe("Confirma tu correo en Hearth · Confirm your email on Hearth");
    expect(verificationTokenIn(sent!)).not.toBe("");
  });

  it("refuses an email invitation with 403 EmailNotVerified while the address is unconfirmed, and sends a fresh link", async () => {
    await withApp({ mailer });
    const { ana, spaceId, token, juan } = await invitedJuan();
    const before = mailsTo(juan.email).length;
    expect(await problem(await accept(juan, token))).toEqual({ status: 403, code: "EmailNotVerified" });
    expect(await memberIds(ana, spaceId)).not.toContain(juan.userId);
    expect(mailsTo(juan.email)).toHaveLength(before + 1);
  });

  it("admits the account once it opened the link it was sent", async () => {
    await withApp({ mailer });
    const { ana, spaceId, token, juan } = await invitedJuan();
    expect((await verify(verificationTokenIn(mailsTo(juan.email).at(-1)!))).status).toBe(204);
    expect((await accept(juan, token)).status).toBe(200);
    expect(await memberIds(ana, spaceId)).toContain(juan.userId);
  });

  it("answers a link it never sent, or a confirmed one used again, without harm", async () => {
    await withApp({ mailer });
    expect(await problem(await verify("not-a-token"))).toEqual({
      status: 422,
      code: "InvalidVerificationLink",
    });
    const juan = await registerUser("Juan");
    const token = verificationTokenIn(mailsTo(juan.email).at(-1)!);
    expect((await verify(token)).status).toBe(204);
    expect((await verify(token)).status).toBe(204);
  });

  it("asks nothing of a link invitation, which any address may accept", async () => {
    await withApp({ mailer });
    const ana = await registerUser("Ana");
    const spaceId = await newSharedSpace(ana);
    const token = await inviteByLink(ana, spaceId, "MEMBER");
    const luis = await registerUser("Luis");
    expect((await accept(luis, token)).status).toBe(200);
  });
});

describe("email verification without SMTP (ruling P282)", () => {
  it("admits an unconfirmed address to its email invitation, as before, and sends nothing", async () => {
    await withApp({});
    const sentBefore = mails.length;
    const { ana, spaceId, token, juan } = await invitedJuan();
    expect((await accept(juan, token)).status).toBe(200);
    expect(await memberIds(ana, spaceId)).toContain(juan.userId);
    expect(mails).toHaveLength(sentBefore);
  });

  it("answers the verification route with InvalidVerificationLink, since it sent no link", async () => {
    await withApp({});
    expect(await problem(await verify("not-a-token"))).toEqual({
      status: 422,
      code: "InvalidVerificationLink",
    });
  });
});
