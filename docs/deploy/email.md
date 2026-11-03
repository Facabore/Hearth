# Email (SMTP)

Hearth can send two kinds of email: invitations (HU-E1-06, issue #85) and the link that confirms an account's address (issue #86). Both go out over SMTP, to a server you already have: your provider's relay, a transactional service's SMTP endpoint, or your own. See [ADR 0007](../adr/0007-smtp-email-with-nodemailer.md) for why.

Email is optional. Without it, Hearth works as before: an invitation answers with its link, and you send the link to the person yourself.

## The two variables

Set them in the `.env` next to `compose.yaml` on the server. The values below are placeholders.

| Variable | Example | What it is |
|---|---|---|
| `SMTP_URL` | `smtp://hearth:CHANGE-ME@smtp.example.com:587` | The mail server, with its user and password. `smtp://` upgrades to TLS when the server offers it (port 587); `smtps://` is TLS from the start (port 465). Special characters in the password are percent-encoded, e.g. `@` as `%40`. |
| `SMTP_FROM` | `Hearth <hearth@example.com>` | The sender of every message, a name and an address or just an address. Required once `SMTP_URL` is set. |

Leave `SMTP_URL` unset, or blank, to send nothing. The app refuses to start, naming the variable, when `SMTP_URL` is not an `smtp://` or `smtps://` URL, or when it is set without `SMTP_FROM`. It never prints either value: `SMTP_URL` carries the password.

## What changes when SMTP is on

- **Invitations by email** are sent to the invited address. The response still carries the link, and `emailSent` says whether the message went out.
- **Addresses are confirmed** (issue #86, rulings P282 and P286). A new account is sent a link, valid 7 days, that confirms its address. An invitation by email then admits only an account whose address is confirmed: until then, accepting it answers `403 EmailNotVerified` and sends a fresh link. Accounts created before you turned SMTP on get theirs the same way, the first time they accept an invitation by email. Link invitations and claim links never ask for a confirmed address, and signing in never does.

An installation without SMTP cannot confirm anyone's address, so it does not ask for one: turning SMTP off turns the check off too.

## When the mail server fails

A message that fails, or takes longer than 5 seconds, is given up and logged as `email.send_failed`, with the failure's name and code and the recipient's domain only. The request that sent it still succeeds. There is no queue and no retry: the inviter still has the link, and a person waiting for a confirmation link gets a new one by accepting the invitation again.

## Trying it locally

`compose.dev.yaml` and `compose.local.yaml` run [Mailpit](https://mailpit.axllent.org/), an SMTP server that keeps every message it receives and sends none of them on. Its inbox is at <http://localhost:8025>.
