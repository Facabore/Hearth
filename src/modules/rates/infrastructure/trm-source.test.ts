import { describe, expect, it } from "vitest";
import type { HttpGet } from "@/shared/infrastructure/http/http-get";
import { TrmSource } from "./trm-source";

const JSON_BODY = JSON.stringify([
  {
    valor: "3316.7",
    unidad: "COP",
    vigenciadesde: "2026-11-14T00:00:00.000",
    vigenciahasta: "2026-11-17T00:00:00.000",
  },
]);

const stub = (fn: HttpGet["getText"]): HttpGet => ({ getText: fn });

describe("TrmSource", () => {
  it("parses the latest TRM as USD->COP", async () => {
    const source = new TrmSource(stub(async () => JSON_BODY));
    const r = await source.fetch();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.source).toBe("trm");
    expect(r.value.base).toBe("USD");
    expect(r.value.date).toBe("2026-11-14");
    expect(r.value.rates).toEqual([{ quote: "COP", rate: "3316.7" }]);
  });

  it("is unavailable when the fetch throws", async () => {
    const source = new TrmSource(
      stub(async () => {
        throw new Error("network down");
      }),
    );
    const r = await source.fetch();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ExchangeRateSourceUnavailable");
  });

  it("is unavailable when the body is empty", async () => {
    const source = new TrmSource(stub(async () => "[]"));
    const r = await source.fetch();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ExchangeRateSourceUnavailable");
  });
});
