import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({}));
const { forwardedHeaders, internalOrigin, meFrom, outcomeOf } = await import("./server");

describe("server reads (ruling P117)", () => {
  it("calls the API over loopback unless INTERNAL_API_ORIGIN says otherwise", () => {
    expect(internalOrigin({})).toBe("http://127.0.0.1:3000");
    expect(internalOrigin({ PORT: "3100" })).toBe("http://127.0.0.1:3100");
    expect(internalOrigin({ INTERNAL_API_ORIGIN: "http://app:3000", PORT: "3100" })).toBe("http://app:3000");
  });

  it("forwards only the cookie, the client address and the language", () => {
    const incoming = new Headers({
      cookie: "hearth.session_token=abc",
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
      "accept-language": "es-CO,es;q=0.9",
      authorization: "Bearer leak",
      host: "hearth.example.com",
    });
    expect(forwardedHeaders(incoming)).toEqual({
      cookie: "hearth.session_token=abc",
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
      "accept-language": "es-CO,es;q=0.9",
    });
    expect(forwardedHeaders(new Headers({ "x-real-ip": "203.0.113.9" }))).toEqual({
      "x-forwarded-for": "203.0.113.9",
    });
  });

  it("sorts an answer into ok, unauthenticated, missing or problem", () => {
    expect(outcomeOf({ data: { id: "s1" }, response: new Response(null, { status: 200 }) })).toEqual({
      kind: "ok",
      data: { id: "s1" },
    });
    expect(
      outcomeOf({ error: { code: "Unauthenticated" }, response: new Response(null, { status: 401 }) }).kind,
    ).toBe("unauthenticated");
    expect(
      outcomeOf({ error: { code: "SpaceNotFound" }, response: new Response(null, { status: 404 }) }).kind,
    ).toBe("missing");
    expect(
      outcomeOf({
        error: { code: "SpaceArchived", status: 409, requestId: "r", title: "", type: "" },
        response: new Response(null, { status: 409 }),
      }),
    ).toMatchObject({ kind: "problem", problem: { code: "SpaceArchived", requestId: "r" } });
  });

  it("reads the profile as the person, as nobody on a 401, and throws on any other failure", () => {
    const me = { id: "u1" };
    expect(meFrom({ data: me, response: new Response(null, { status: 200 }) })).toEqual(me);
    expect(
      meFrom({ error: { code: "Unauthenticated" }, response: new Response(null, { status: 401 }) }),
    ).toBeNull();
    // A 500 is not "signed out": answering null would send a signed-in person to the sign-in screen.
    expect(() =>
      meFrom({ error: { code: "InternalError" }, response: new Response(null, { status: 500 }) }),
    ).toThrow("Reading the profile failed: InternalError");
  });
});
