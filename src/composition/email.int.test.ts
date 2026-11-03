import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/route";
import { setContainerForTests, type Container } from "@/composition/container";
import type { Env } from "@/shared/infrastructure/env";
import { call, registerUser, startTestApp, uniqueEmail } from "../../tests/support/app";
import { mailsTo, startMailpit, type Mailpit } from "../../tests/support/mailpit";
import { newSharedSpace } from "../../tests/support/spaces";

let mailpit: Mailpit;
let app: Container | undefined;
beforeAll(async () => {
  mailpit = await startMailpit();
}, 120_000);
afterAll(async () => {
  await stopApp();
  mailpit.stop();
});

const stopApp = async () => {
  setContainerForTests(undefined);
  await app?.pool.end();
  app = undefined;
};

/** A fresh container over the test database, with `env` on top of the test environment. */
const withApp = async (env: Partial<Env>) => {
  await stopApp();
  app = startTestApp({}, env);
};

/** Ana invites `email` to her new Household; answers the response body. */
const invite = async (email: string) => {
  const ana = await registerUser("Ana");
  const spaceId = await newSharedSpace(ana);
  const response = await call(createInvitation, "POST", `/api/v1/spaces/${spaceId}/invitations`, {
    user: ana,
    params: { spaceId },
    body: { kind: "EMAIL", email, role: "MEMBER" },
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { url: string; emailSent: boolean };
};

describe("invitation emails over SMTP (issue #85, ADR 0007)", () => {
  it("sends the invitation to the invited address, from SMTP_FROM, with the link in both languages", async () => {
    await withApp({ SMTP_URL: mailpit.smtpUrl, SMTP_FROM: "Hearth <hearth@example.com>" });
    const juan = uniqueEmail("juan");
    const { url, emailSent } = await invite(juan);
    expect(emailSent).toBe(true);
    const [mail, ...others] = await mailsTo(mailpit, juan);
    expect(others).toEqual([]);
    expect(mail).toMatchObject({
      from: "hearth@example.com",
      subject: "Te invitaron a Household en Hearth · You're invited to Household on Hearth",
    });
    expect(mail!.text).toContain("Te invitaron a unirte a Household en Hearth");
    expect(mail!.text).toContain("You've been invited to join Household on Hearth");
    expect(mail!.text.split(url)).toHaveLength(3);
  });

  it("still creates the invitation, with emailSent false, when the mail server is down", async () => {
    await withApp({ SMTP_URL: "smtp://127.0.0.1:9", SMTP_FROM: "hearth@example.com" });
    const juan = uniqueEmail("juan");
    expect((await invite(juan)).emailSent).toBe(false);
    expect(await mailsTo(mailpit, juan)).toEqual([]);
  });

  it("sends nothing without SMTP_URL, as before", async () => {
    await withApp({});
    const juan = uniqueEmail("juan");
    expect((await invite(juan)).emailSent).toBe(false);
    expect(await mailsTo(mailpit, juan)).toEqual([]);
  });
});
