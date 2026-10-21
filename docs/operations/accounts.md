# User accounts

How the person who runs a Hearth installation (the operator) looks after the people who sign in to it.

## Resetting a forgotten password

Hearth cannot send mail yet, so nobody can reset their own password. The sign-in screen tells a person who forgot theirs to ask the administrator, and the operator resets it from the VPS with a script that ships in the `hearth-migrator` image. Run it in the directory that holds `compose.yaml` and `.env`.

Type the new password when the script asks for it. The terminal does not show what you type:

```
docker compose run --rm migrate node scripts/reset-password.mjs ana@example.com
New password:
Password reset for ana@example.com; 2 sessions ended.
```

Or, when the password comes from a file, pipe the file in. `-T` turns off the terminal that `docker compose run` would otherwise allocate:

```
docker compose run --rm -T migrate node scripts/reset-password.mjs ana@example.com < new-password.txt
```

Remove the file afterwards (`shred -u new-password.txt`, or `rm` where `shred` is missing), and do not leave the password in your shell history or in a chat.

What the script does:

- The email is trimmed and lower-cased, as it is at sign-up.
- The password is the first line of standard input. It is never an argument or an environment variable, so it stays out of `ps` and the shell history, and the script never prints it or its hash. It must have 8 to 128 characters, the same bounds as sign-up.
- The new password replaces the old one and **every session of that person ends**, on every device. They must sign in again with the new password. Other people's sessions are not touched. Both changes happen in one transaction, so the script either does both or neither.
- It prints `Password reset for <email>; <n> sessions ended.` and exits 0. Tell the person the new password through a channel you trust.

When it does not succeed, it prints one line that names the reason and exits with:

| Exit code | Meaning                                                                          |
| --------- | -------------------------------------------------------------------------------- |
| 1         | `DATABASE_URL` is missing, or the database could not be reached                  |
| 2         | Usage: the script takes exactly one argument, the email                          |
| 3         | No user is registered with that email                                            |
| 4         | That user has no password account, so there is nothing to reset                  |
| 5         | The password does not have 8 to 128 characters (or nothing was read from stdin)  |

Nothing is changed for exit codes 2 to 5.

## Why there is no email reset yet

A reset link needs a mail server that Hearth does not have (the decision is recorded in ruling P144). Until Hearth can send mail, the operator resets passwords by hand, which also means a reset always involves someone who is trusted with the installation. Email-based reset will be added together with outgoing mail.

## Who can sign up

Whether new people can create their own account is the operator's choice, set with the `HEARTH_SIGN_UP` variable. See [Closing sign-up](deploy.md#closing-sign-up).
