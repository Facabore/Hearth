import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://hearth.test${path}`, cookie ? { headers: { cookie } } : undefined);

describe("proxy (HU-E9-01, rulings P125 and P145)", () => {
  it("sends a protected page without a session cookie to sign-in, keeping the path and its query", () => {
    const response = proxy(request("/spaces/s1/transactions?period=2026-10"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://hearth.test/sign-in?next=%2Fspaces%2Fs1%2Ftransactions%3Fperiod%3D2026-10",
    );
  });

  it.each(["/sign-in", "/sign-up"])(
    "lets %s through with or without a cookie: only the public layout's session check decides, so a stale cookie never loops",
    (path) => {
      for (const cookie of [undefined, "hearth.session_token=stale"]) {
        const response = proxy(request(path, cookie));
        expect(response.status).toBe(200);
        expect(response.headers.get("x-middleware-next")).toBe("1");
      }
    },
  );

  it("lets a protected page through when a session cookie is present, handing the page its own path", () => {
    const response = proxy(request("/settings?tab=region", "hearth.session_token=abc"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-x-hearth-path")).toBe("/settings?tab=region");
  });

  it("tells the page a document request from a client navigation, never trusting the browser's own claim (#196)", () => {
    const page = (headers: Record<string, string>) =>
      proxy(
        new NextRequest("http://hearth.test/spaces/s1", {
          headers: { cookie: "hearth.session_token=abc", ...headers },
        }),
      ).headers.get("x-middleware-request-x-hearth-document");
    expect(page({})).toBe("1");
    expect(page({ rsc: "1" })).toBe("0");
    expect(page({ rsc: "1", "x-hearth-document": "1" })).toBe("0");
  });

  it.each(["/invitations/tok-1", "/claims/tok-1"])(
    "lets %s through without a session cookie, with a stale one and with a live one (ruling P157)",
    (path) => {
      for (const cookie of [undefined, "hearth.session_token=stale", "hearth.session_token=abc"]) {
        const response = proxy(request(path, cookie));
        expect(response.status).toBe(200);
        expect(response.headers.get("x-middleware-next")).toBe("1");
        expect(response.headers.get("x-middleware-request-x-hearth-path")).toBe(path);
      }
    },
  );

  it.each([
    "/invitations",
    "/invitations/",
    "/invitationsx/tok",
    "/invitations/tok/extra",
    "/invitations//settings",
    "/claims/a/../../settings",
    "/claims/a/%2e%2e/%2e%2e/settings",
    "/invitations/a/..%2f..%2fsettings",
  ])("keeps %s behind the session guard: an open prefix opens one token page and nothing else", (path) => {
    const response = proxy(request(path));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/sign-in");
  });

  it("lets the sign-up screen through with the invitation and the page to return to", () => {
    const response = proxy(request("/sign-up?invitation=tok-1&next=%2Finvitations%2Ftok-1"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
