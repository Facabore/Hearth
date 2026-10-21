import { describe, expect, it } from "vitest";
import { expiredSignInUrl, isOpenPath, redirectFor, safeNext } from "./auth-redirect";

describe("safeNext (HU-E9-01, ruling P125): only same-origin paths are honoured", () => {
  it.each([
    ["/spaces/s1/transactions?period=2026-10", "/spaces/s1/transactions?period=2026-10"],
    ["/settings", "/settings"],
    ["/invitations/AbC_123-x", "/invitations/AbC_123-x"],
    ["/claims/AbC_123-x", "/claims/AbC_123-x"],
    ["//invitations/x", "/"],
    ["/invitations/x\\evil.example", "/"],
    ["/claims/\t/evil.example", "/"],
    ["https://hearth.example/invitations/x", "/"],
    ["//evil.example/x", "/"],
    ["https://evil.example", "/"],
    ["/\\evil.example", "/"],
    ["/\t/evil.example", "/"],
    ["/\n/evil.example", "/"],
    ["spaces/s1", "/"],
    ["/sign-in", "/"],
    ["/sign-up?next=/x", "/"],
    ["", "/"],
    [null, "/"],
    [undefined, "/"],
  ])("%j → %j", (next, expected) => {
    expect(safeNext(next)).toBe(expected);
  });
});

describe("redirectFor", () => {
  it("sends a request without a session to the sign-in screen, keeping the path and its query", () => {
    expect(
      redirectFor({ pathname: "/spaces/s1/transactions", search: "?period=2026-10", hasSession: false }),
    ).toBe("/sign-in?next=%2Fspaces%2Fs1%2Ftransactions%3Fperiod%3D2026-10");
    expect(redirectFor({ pathname: "/", search: "", hasSession: false })).toBe("/sign-in");
  });

  it("lets public screens through, and protected ones when a session cookie is present", () => {
    expect(redirectFor({ pathname: "/sign-in", search: "?next=%2Fsettings", hasSession: false })).toBeNull();
    expect(redirectFor({ pathname: "/sign-up", search: "", hasSession: true })).toBeNull();
    // Ruling P145: a cookie alone does not send a signed-in person away from a public screen (a stale cookie would
    // loop); the public layout's real session check does.
    expect(redirectFor({ pathname: "/sign-in", search: "", hasSession: true })).toBeNull();
    expect(redirectFor({ pathname: "/settings", search: "", hasSession: true })).toBeNull();
  });
});

describe("open paths (HU-E9-05, ruling P157)", () => {
  it("lets the invitation and claim pages through with or without a session", () => {
    for (const hasSession of [false, true]) {
      expect(redirectFor({ pathname: "/invitations/tok", search: "", hasSession })).toBeNull();
      expect(redirectFor({ pathname: "/claims/tok", search: "", hasSession })).toBeNull();
    }
    expect(redirectFor({ pathname: "/invitations", search: "", hasSession: false })).toBe(
      "/sign-in?next=%2Finvitations",
    );
    expect(redirectFor({ pathname: "/invitationsx/tok", search: "", hasSession: false })).toBe(
      "/sign-in?next=%2Finvitationsx%2Ftok",
    );
  });

  it.each([
    ["/invitations/tok", true],
    ["/claims/AbC_123-x", true],
    ["/invitations/", false],
    ["/claims/", false],
    ["/invitations", false],
    ["/claims", false],
    ["/invitationsx/tok", false],
    ["/Invitations/tok", false],
    ["/settings", false],
    ["/", false],
    ["/invitations/tok/extra", false],
    ["/invitations//settings", false],
    ["/claims/a/../../settings", false],
    ["/claims/..", false],
    ["/claims/.", false],
    ["/invitations/a\\b", false],
    ["//invitations/tok", false],
    ["/sign-in/invitations/tok", false],
    ["/x/invitations/tok", false],
  ])("isOpenPath(%j) is %j: one token under an open prefix, nothing that can climb out", (path, open) => {
    expect(isOpenPath(path)).toBe(open);
    if (!open) {
      expect(redirectFor({ pathname: path, search: "", hasSession: false })).not.toBeNull();
    }
  });

  it("keeps a protected path protected when an open path appears in its query", () => {
    expect(redirectFor({ pathname: "/settings", search: "?next=/invitations/tok", hasSession: false })).toBe(
      "/sign-in?next=%2Fsettings%3Fnext%3D%2Finvitations%2Ftok",
    );
  });
});

describe("expiredSignInUrl (ruling P151)", () => {
  it("returns to the page and its query after the person signs in again, and marks the screen as expired", () => {
    const url = expiredSignInUrl({ pathname: "/spaces/s1/transactions", search: "?period=2026-10" });
    expect(url).toBe("/sign-in?next=%2Fspaces%2Fs1%2Ftransactions%3Fperiod%3D2026-10&expired=1");
    const params = new URL(url, "http://hearth.test").searchParams;
    expect(params.get("expired")).toBe("1");
    expect(safeNext(params.get("next"))).toBe("/spaces/s1/transactions?period=2026-10");
  });

  it("keeps a query parameter named expired inside next, and never reads the marker as a destination", () => {
    const params = new URL(
      expiredSignInUrl({ pathname: "/settings", search: "?expired=1" }),
      "http://hearth.test",
    ).searchParams;
    expect(safeNext(params.get("next"))).toBe("/settings?expired=1");
    expect(safeNext(params.get("expired"))).toBe("/");
  });
});
