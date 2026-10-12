import { describe, expect, it } from "vitest";
import { etagOf, ifMatchVersion } from "./etag";
import { toJsonSafe } from "./json";

const withIfMatch = (value?: string) =>
  new Request("http://localhost/x", value === undefined ? {} : { headers: { "if-match": value } });

describe("ETags", () => {
  it("quotes the version", () => {
    expect(etagOf(4)).toBe('"4"');
  });

  it("reads If-Match as a version, absent as null", () => {
    expect(ifMatchVersion(withIfMatch('"3"'))).toEqual({ ok: true, value: 3 });
    expect(ifMatchVersion(withIfMatch(' "12" '))).toEqual({ ok: true, value: 12 });
    expect(ifMatchVersion(withIfMatch())).toEqual({ ok: true, value: null });
  });

  it.each(["3", '"abc"', 'W/"3"', "*", '"-1"', `"${"9".repeat(16)}"`])(
    "rejects the malformed If-Match %s with PreconditionFailed",
    (value) => {
      const result = ifMatchVersion(withIfMatch(value));
      expect(!result.ok && result.error.code).toBe("PreconditionFailed");
    },
  );
});

describe("toJsonSafe", () => {
  it("turns nested bigints into strings and keeps undefined", () => {
    expect(toJsonSafe({ a: 1n, b: [2n, { c: 3n }], d: "x" })).toEqual({
      a: "1",
      b: ["2", { c: "3" }],
      d: "x",
    });
    expect(toJsonSafe(undefined)).toBeUndefined();
  });
});
