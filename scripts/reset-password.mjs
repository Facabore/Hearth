import { hashPassword } from "better-auth/crypto";
import pg from "pg";
import { Writable } from "node:stream";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

// Same bounds as createAuth in src/modules/identity/infrastructure/better-auth.ts.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

// Same one-liner as normalizeEmail in src/modules/identity/application/sign-up.ts (a script cannot import TypeScript).
const normalizeEmail = (email) => email.trim().toLowerCase();

/**
 * Gives the person with `email` a new password and signs them out everywhere, in one transaction (ruling P144).
 * Resolves to the process exit code and the one line to print: stdout for 0, stderr otherwise.
 * Neither the password nor its hash ever reaches the message.
 */
export async function resetPassword(url, email, password) {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return {
      code: 5,
      message: `The password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
    };
  }
  const address = normalizeEmail(email);
  const hash = await hashPassword(password);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query('SELECT id FROM "user" WHERE email = $1', [address]);
    const userId = found.rows[0]?.id;
    if (userId === undefined) {
      await client.query("ROLLBACK");
      return { code: 3, message: `No user is registered with the email ${address}.` };
    }
    const updated = await client.query(
      "UPDATE account SET password = $1, updated_at = now() WHERE user_id = $2 AND provider_id = 'credential'",
      [hash, userId],
    );
    if (updated.rowCount === 0) {
      await client.query("ROLLBACK");
      return { code: 4, message: `${address} has no password account, so there is no password to reset.` };
    }
    const ended = await client.query("DELETE FROM session WHERE user_id = $1", [userId]);
    await client.query("COMMIT");
    return { code: 0, message: `Password reset for ${address}; ${ended.rowCount} sessions ended.` };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

/** The first line of a piped stdin, without its `\r?\n`; the whole input when it has no line ending. */
function readFirstLine(input) {
  return new Promise((resolve, reject) => {
    let buffered = "";
    input.setEncoding("utf8");
    input.on("error", reject);
    input.on("end", () => resolve(buffered));
    input.on("data", (chunk) => {
      buffered += chunk;
      const end = buffered.indexOf("\n");
      if (end >= 0) {
        input.pause();
        resolve(buffered.slice(0, end).replace(/\r$/, ""));
      }
    });
  });
}

/** Prompts on stderr and reads one line from the terminal without echoing it. */
function promptHidden(prompt) {
  return new Promise((resolve) => {
    process.stderr.write(prompt);
    const muted = new Writable({ write: (_chunk, _encoding, done) => done() });
    const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
    rl.once("line", (line) => {
      rl.close();
      process.stderr.write("\n");
      resolve(line);
    });
    rl.once("SIGINT", () => {
      process.stderr.write("\n");
      process.exit(130);
    });
    rl.once("close", () => resolve(""));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Missing or invalid environment variables: DATABASE_URL");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    console.error("Usage: node scripts/reset-password.mjs <email>  (the new password is read from stdin)");
    process.exit(2);
  }
  let outcome;
  try {
    const password = process.stdin.isTTY
      ? await promptHidden("New password: ")
      : await readFirstLine(process.stdin);
    outcome = await resetPassword(url, args[0], password);
  } catch (error) {
    console.error(`Password reset failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  }
  if (outcome.code === 0) console.log(outcome.message);
  else console.error(outcome.message);
  process.exitCode = outcome.code;
}
