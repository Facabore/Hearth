import { describe, expect, it } from "vitest";
import {
  expiredSignInUrl,
  isOpenPath,
  nextFromPath,
  redirectFor,
  safeNext,
  safeReturnTo,
  withReturnTo,
} from "./auth-redirect";

/** The inputs of ruling P125 and what `safeNext` makes of each; `safeReturnTo` follows the same rules. */
const NEXT_CASES: readonly [string | null | undefined, string][] = [
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
  // N9: after signing in a person never lands on raw JSON (not an open redirect, but not a screen either).
  ["/api/v1/me", "/"],
  ["/api/v1/spaces?x=1", "/"],
  ["/api", "/"],
  ["/api?x=1", "/"],
  ["/%61pi/v1/me", "/"],
  ["/x/../api/v1/me", "/"],
  ["/spaces/s1/../../api/v1/me", "/"],
  ["/apiary", "/apiary"],
  ["/spaces/s1/api/v1", "/spaces/s1/api/v1"],
];

describe("safeNext (HU-E9-01, ruling P125): only same-origin paths are honoured", () => {
  it.each(NEXT_CASES)("%j → %j", (next, expected) => {
    expect(safeNext(next)).toBe(expected);
  });
});

describe('safeReturnTo (the `returnTo` of a flow): the same rules as safeNext, null instead of "/"', () => {
  it.each(NEXT_CASES)("%j → honoured only when safeNext honours it", (value, expected) => {
    expect(safeReturnTo(value)).toBe(value === expected ? expected : null);
  });

  it("honours a same-origin path with its query", () => {
    expect(safeReturnTo("/spaces/s1")).toBe("/spaces/s1");
    expect(safeReturnTo("/spaces/s1/transactions?period=2026-10")).toBe(
      "/spaces/s1/transactions?period=2026-10",
    );
  });

  it("honours the origin's own root", () => {
    expect(safeReturnTo("/")).toBe("/");
  });

  it.each(["/\u0000/x", "/\u007f", "/a\r\nb", "/a\\b", "\\\\evil.example"])(
    "rejects control characters and backslashes: %j",
    (value) => {
      expect(safeReturnTo(value)).toBeNull();
    },
  );
});

describe("withReturnTo: the entry link of a flow", () => {
  it("appends the origin as an encoded returnTo", () => {
    expect(withReturnTo("/spaces/s1/accounts/new", "/spaces/s1/accounts")).toBe(
      "/spaces/s1/accounts/new?returnTo=%2Fspaces%2Fs1%2Faccounts",
    );
    expect(withReturnTo("/spaces/new?from=s1", "/spaces/s1/transactions?period=2026-10")).toBe(
      "/spaces/new?from=s1&returnTo=%2Fspaces%2Fs1%2Ftransactions%3Fperiod%3D2026-10",
    );
  });

  it("leaves the link as it is when the origin is not a valid returnTo", () => {
    expect(withReturnTo("/spaces/new?from=s1", "//evil.example")).toBe("/spaces/new?from=s1");
    expect(withReturnTo("/spaces/new?from=s1", null)).toBe("/spaces/new?from=s1");
    expect(withReturnTo("/spaces/new", undefined)).toBe("/spaces/new");
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

describe("the app icons (390 px review, S6)", () => {
  it("are served without a session, so the sign-in screen has its icon too", () => {
    expect(redirectFor({ pathname: "/icon.svg", search: "?abc123", hasSession: false })).toBeNull();
    expect(redirectFor({ pathname: "/apple-icon.png", search: "", hasSession: false })).toBeNull();
  });

  it("open nothing else: a lookalike path or an icon in a query stays protected", () => {
    expect(redirectFor({ pathname: "/icon.svg/x", search: "", hasSession: false })).toBe(
      "/sign-in?next=%2Ficon.svg%2Fx",
    );
    expect(redirectFor({ pathname: "/spaces", search: "?next=/icon.svg", hasSession: false })).toBe(
      "/sign-in?next=%2Fspaces%3Fnext%3D%2Ficon.svg",
    );
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

describe("nextFromPath (a signed-in person on /sign-in?next=…)", () => {
  it("takes the destination the proxy recorded, already validated", () => {
    expect(nextFromPath("/sign-in?next=%2Fspaces%2Fs1%2Ftransactions%3Fperiod%3D2026-10")).toBe(
      "/spaces/s1/transactions?period=2026-10",
    );
    expect(nextFromPath("/sign-up?invitation=T&next=%2Finvitations%2FT")).toBe("/invitations/T");
  });

  it("falls back to the home without a destination, or with one that is not safe", () => {
    for (const path of [
      "/sign-in",
      "/sign-in?expired=1",
      "/sign-in?next=",
      "/sign-in?next=%2F%2Fevil.example",
      "/sign-in?next=https%3A%2F%2Fevil.example",
      "/sign-in?next=%2Fapi%2Fv1%2Fme",
      "/sign-in?next=%2Fsign-in",
      null,
      undefined,
    ])
      expect(nextFromPath(path)).toBe("/");
  });
});
