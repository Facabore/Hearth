import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createSmtpMailer, domainOf, type MailLog } from "./smtp-mailer";

/** A loopback TCP server that accepts connections and never says a word: an SMTP server that hangs. */
const silentServer = async (): Promise<{ server: Server; port: number }> => {
  const sockets: Socket[] = [];
  const server = createServer((socket) => sockets.push(socket));
  server.on("close", () => sockets.forEach((s) => s.destroy()));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { server, port: address.port };
};

/** A port nothing listens on: a server that is down. */
const closedPort = async (): Promise<number> => {
  const { server, port } = await silentServer();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
};

const recordingLog = () => {
  const events: { event: string; data: Record<string, unknown> }[] = [];
  const log: MailLog = { error: (event, data = {}) => events.push({ event, data }) };
  return { log, events };
};

const message = {
  to: "juan.perez@example.com",
  subject: "Hearth",
  text: "https://hearth.example/invitations/secret-token",
};

let servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  servers = [];
});

describe("SmtpMailer (issue #85, ADR 0007)", () => {
  it("answers false within its bound when the server never answers, and logs without the address or the token", async () => {
    const { server, port } = await silentServer();
    servers.push(server);
    const { log, events } = recordingLog();
    const mailer = createSmtpMailer({
      url: `smtp://hearth:s3cret-pass@127.0.0.1:${port}`,
      from: "hearth@example.com",
      log,
      timeoutMs: 200,
    });
    const started = Date.now();
    expect(await mailer.send(message)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(events).toEqual([
      { event: "email.send_failed", data: { error: "Timeout", recipientDomain: "example.com" } },
    ]);
    const logged = JSON.stringify(events);
    for (const secret of ["juan.perez", "secret-token", "s3cret-pass"]) expect(logged).not.toContain(secret);
  });

  it("answers false when the server is down, and logs the failure's name and code through failureOf", async () => {
    const { log, events } = recordingLog();
    const mailer = createSmtpMailer({
      url: `smtp://127.0.0.1:${await closedPort()}`,
      from: "hearth@example.com",
      log,
    });
    expect(await mailer.send(message)).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: "email.send_failed", data: { recipientDomain: "example.com" } });
    expect(Object.keys(events[0]!.data).sort()).toEqual(["code", "error", "recipientDomain"]);
    expect(JSON.stringify(events)).not.toContain("juan.perez");
  });

  it("names only the domain of an address", () => {
    expect(domainOf("Juan.Perez@Example.COM")).toBe("example.com");
    expect(domainOf("not an address")).toBe("unknown");
  });
});
