import nodemailer from "nodemailer";
import { failureOf } from "@/shared/kernel";

/** One plain-text message to one recipient. */
export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** Sends a message; resolves whether it went out, and never rejects (ADR 0007). */
export interface Mailer {
  send(message: MailMessage): Promise<boolean>;
}

/** Where a failed send is reported: the app's logger. */
export interface MailLog {
  error(event: string, data?: Record<string, unknown>): void;
}

/** ADR 0007: how long a send may take before it counts as failed, so a slow server never holds a request. */
export const SEND_TIMEOUT_MS = 5_000;

/** The part of an address a log may name: its domain, never the person's mailbox. */
export const domainOf = (address: string): string => {
  const at = address.lastIndexOf("@");
  return at > 0 && at < address.length - 1 ? address.slice(at + 1).toLowerCase() : "unknown";
};

class SendTimeout extends Error {
  override readonly name = "Timeout";
}

/**
 * Issue #85, ADR 0007: sends over SMTP with nodemailer. A send that fails, or outlasts `timeoutMs`, resolves false
 * and logs the failure's name and code (`failureOf`) and the recipient's domain: never the address, the message (it
 * may carry a token) or the URL (it carries the password).
 */
export const createSmtpMailer = (options: {
  readonly url: string;
  readonly from: string;
  readonly log: MailLog;
  readonly timeoutMs?: number;
}): Mailer => {
  const timeoutMs = options.timeoutMs ?? SEND_TIMEOUT_MS;
  // nodemailer's own timeouts outlast the bound below, so a hung server is always reported as this send's Timeout;
  // they still close the socket the timed-out send left behind.
  const socketTimeout = timeoutMs + 1_000;
  const transport = nodemailer.createTransport(
    {
      url: options.url,
      connectionTimeout: socketTimeout,
      greetingTimeout: socketTimeout,
      socketTimeout,
      dnsTimeout: socketTimeout,
    },
    { from: options.from },
  );
  return {
    send: async (message) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SendTimeout()), timeoutMs);
      });
      try {
        await Promise.race([
          transport.sendMail({ to: message.to, subject: message.subject, text: message.text }),
          expired,
        ]);
        return true;
      } catch (error) {
        options.log.error("email.send_failed", {
          ...failureOf(error),
          recipientDomain: domainOf(message.to),
        });
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  };
};
