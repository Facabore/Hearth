import { execFileSync } from "node:child_process";
import { parsePublishedPort } from "./postgres-global-setup";
import { until } from "./locks";

/** ADR 0007: the SMTP sink the integration test sends to and reads back from, as in compose.dev.yaml. */
export const MAILPIT_IMAGE = "axllent/mailpit:v1.31.6";

const docker = (...args: string[]): string => execFileSync("docker", args, { encoding: "utf8" }).trim();

export interface Mailpit {
  /** Where the app sends, e.g. `smtp://127.0.0.1:49153`. */
  readonly smtpUrl: string;
  /** Mailpit's HTTP API, e.g. `http://127.0.0.1:49154`. */
  readonly apiUrl: string;
  readonly stop: () => void;
}

/**
 * A disposable Mailpit through the Docker CLI, like the test database. TEST_SMTP_URL and TEST_MAILPIT_URL point the
 * test at a running one instead (CI's service container).
 */
export const startMailpit = async (): Promise<Mailpit> => {
  const given = { smtpUrl: process.env.TEST_SMTP_URL, apiUrl: process.env.TEST_MAILPIT_URL };
  let mailpit: Mailpit;
  if (given.smtpUrl && given.apiUrl) {
    mailpit = { smtpUrl: given.smtpUrl, apiUrl: given.apiUrl, stop: () => undefined };
  } else {
    const host = process.env.TEST_DOCKER_PUBLISH_HOST ?? "127.0.0.1";
    const id = docker(
      "run",
      "-d",
      "--rm",
      "--label",
      "hearth.test=true",
      "-p",
      `${host}::1025`,
      "-p",
      `${host}::8025`,
      MAILPIT_IMAGE,
    );
    const reach = process.env.TEST_DATABASE_HOST ?? "127.0.0.1";
    mailpit = {
      smtpUrl: `smtp://${reach}:${parsePublishedPort(docker("port", id, "1025/tcp"))}`,
      apiUrl: `http://${reach}:${parsePublishedPort(docker("port", id, "8025/tcp"))}`,
      stop: () => {
        docker("rm", "-f", id);
      },
    };
  }
  await until("Mailpit's API to answer", async () => {
    try {
      return (await fetch(`${mailpit.apiUrl}/api/v1/info`)).ok;
    } catch {
      return false;
    }
  });
  return mailpit;
};

export interface ReceivedMail {
  readonly from: string;
  readonly subject: string;
  readonly text: string;
}

/** The messages Mailpit received for `address`, newest first. */
export const mailsTo = async (mailpit: Mailpit, address: string): Promise<ReceivedMail[]> => {
  const listed = (await (await fetch(`${mailpit.apiUrl}/api/v1/messages?limit=200`)).json()) as {
    messages: { ID: string; To: { Address: string }[] }[];
  };
  const ids = listed.messages
    .filter((m) => m.To.some((to) => to.Address.toLowerCase() === address.toLowerCase()))
    .map((m) => m.ID);
  return Promise.all(
    ids.map(async (id) => {
      const message = (await (await fetch(`${mailpit.apiUrl}/api/v1/message/${id}`)).json()) as {
        From: { Address: string };
        Subject: string;
        Text: string;
      };
      return { from: message.From.Address, subject: message.Subject, text: message.Text };
    }),
  );
};
