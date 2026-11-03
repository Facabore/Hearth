# ADR 0007 — Send email over SMTP with nodemailer

- Status: Accepted (2026-11-02)
- Story: HU-E1-06 (issue #85), issue #86

## Context

Invitations by email (HU-E1-06) go through the `EmailSender` port, and production has bound a sender that sends nothing since M2-A: the inviter shares the link by hand. Issue #86 needs email too, so that an account can prove it owns its address before an email-bound invitation admits it.

Hearth is self-hosted, so the transport must be one an owner already has: an SMTP server (their provider's relay, a transactional service's SMTP endpoint, or a local one). Candidates:

- **nodemailer** 10.1.7: the usual Node.js SMTP client. No runtime dependencies, ships its own types since 10.0, takes the whole connection as one URL (`smtp://user:password@host:587`, `smtps://` for implicit TLS) and has connection, greeting and socket timeouts.
- **emailjs**: a smaller SMTP client, with fewer releases and fewer users. Its types and its TLS options are thinner.
- **A provider's HTTP API** (Resend, Postmark, SES): one vendor per installation and its own SDK, which a self-hosted app should not impose.
- **A hand-written SMTP client over `node:net`**: TLS upgrade, authentication and dot-stuffing are easy to get wrong, and nobody would maintain them.

## Decision

Use nodemailer 10.1.7, pinned like the rest of the stack. Only `src/shared/infrastructure/email/` imports it.

- Configuration is two variables of the env schema (`src/shared/infrastructure/env.ts`): `SMTP_URL`, optional, and `SMTP_FROM`, required once `SMTP_URL` is set. Without `SMTP_URL` the app keeps the sender that sends nothing and behaves as before.
- `SmtpMailer` sends one plain-text message and answers whether it went out. It never throws: a send that fails, or takes longer than 5 seconds, resolves `false`, so a slow or broken mail server never fails or holds the request that sent it. Invitations are still sent after their transaction commits.
- Its log line names the failure through `failureOf` and the recipient's domain only. It never logs the address, the message (it carries a token) or `SMTP_URL` (it carries the password).
- Mailpit stands in for the mail server in development (`compose.dev.yaml`, `compose.local.yaml`) and in the integration test, which sends a real invitation and reads it back from Mailpit's API.

## Consequences

- One new runtime dependency, with no transitive ones.
- Ruling P282 ties email verification (#86) to `SMTP_URL`: an installation without SMTP cannot verify addresses, so it does not require it.
- Email copy lives next to the adapter that composes it, in both languages, since a message leaves before anyone has chosen a language on a screen.
- No queue and no retry: a message that fails is lost, and the inviter still has the link. A queue is a later decision, if pilots need one.
