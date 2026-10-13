import { createHash, randomBytes } from "node:crypto";
import type { InvitationTokens, IssuedToken } from "../application/invitation-ports";

const sha256 = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

/** HU-E1-06: 256 random bits as base64url (43 characters); only the SHA-256 hex digest is stored. */
export const cryptoInvitationTokens: InvitationTokens = {
  issue: (): IssuedToken => {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: sha256(token) };
  },
  hash: sha256,
};
