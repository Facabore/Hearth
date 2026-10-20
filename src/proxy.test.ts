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
});
