import { describe, expect, it } from "vitest";
import { domainError, err, ok, type AuthUser } from "@/shared/kernel";
import { BUILT_IN_RULES, type ProfileChange } from "../domain/preferences";
import { createFindUserByHandle, type HandleHolder } from "./handles";
import { createUpdateProfile } from "./profile";

const ana: AuthUser = {
  id: "u-ana",
  name: "Ana",
  email: "ana@example.com",
  locale: "es",
  timezone: "America/Bogota",
};
const bruno: HandleHolder = { userId: "u-bruno", handle: "bruno_b", displayName: "Bruno" };

describe("finding someone by their @ (P339, S3)", () => {
  const holders = [bruno, { userId: ana.id, handle: "ana", displayName: "Ana" }];
  const find = (allowed = true) =>
    createFindUserByHandle({
      handles: { findByHandle: async (handle) => holders.find((h) => h.handle === handle) ?? null },
      throttle: { allows: () => allowed },
    });

  it("answers the handle and the name of an exact match, read in lower case", async () => {
    expect(await find()({ userId: ana.id, handle: "@Bruno_B" })).toEqual(
      ok({ handle: "bruno_b", displayName: "Bruno" }),
    );
  });

  it("is UserNotFound for an unknown, a malformed and the caller's own handle", async () => {
    for (const handle of ["bruno", "b!", "ana"]) {
      expect(await find()({ userId: ana.id, handle })).toEqual(err(domainError("UserNotFound")));
    }
  });

  it("is TooManyRequests once the person made too many lookups", async () => {
    expect(await find(false)({ userId: ana.id, handle: "bruno_b" })).toEqual(
      err(domainError("TooManyRequests")),
    );
  });
});

describe("the handle through the profile (P339, S2)", () => {
  const world = (taken: string[] = []) => {
    const saved: string[] = [];
    const writes: ProfileChange[] = [];
    const update = createUpdateProfile({
      profiles: { saveProfile: async (_userId, fields) => void writes.push(fields) },
      handles: {
        setHandle: async (_userId, handle) => {
          if (taken.includes(handle)) return "taken";
          saved.push(handle);
          return "saved";
        },
      },
      rules: { rules: async () => BUILT_IN_RULES },
    });
    return { update, saved, writes };
  };

  it("stores the handle in lower case, without the @, and never clears it (P343)", async () => {
    const { update, saved } = world();
    expect((await update({ user: ana, handle: " @Ana_2 " })).ok).toBe(true);
    expect(await update({ user: ana, handle: null })).toEqual(
      err(domainError("InvalidHandle", { length: 0 })),
    );
    expect(saved).toEqual(["ana_2"]);
  });

  it("refuses an invalid handle and one someone else holds, and writes nothing else", async () => {
    const { update, saved, writes } = world(["bruno_b"]);
    expect(await update({ user: ana, handle: "a-b", timezone: "Europe/Madrid" })).toEqual(
      err(domainError("InvalidHandle", { length: 3 })),
    );
    expect(await update({ user: ana, handle: "Bruno_B", timezone: "Europe/Madrid" })).toEqual(
      err(domainError("HandleTaken")),
    );
    expect(saved).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("leaves the handle alone when the change does not name it", async () => {
    const { update, saved } = world();
    expect((await update({ user: ana, timezone: "Europe/Madrid" })).ok).toBe(true);
    expect(saved).toEqual([]);
  });
});
