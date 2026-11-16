import { describe, expect, it } from "vitest";
import type { HttpGet } from "@/shared/infrastructure/http/http-get";
import { EcbSource } from "./ecb-source";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <Cube>
    <Cube time='2026-11-13'>
      <Cube currency='USD' rate='1.1052'/>
      <Cube currency='JPY' rate='176.83'/>
      <Cube currency='MXN' rate='20.5491'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

const stub = (fn: HttpGet["getText"]): HttpGet => ({ getText: fn });

describe("EcbSource", () => {
  it("parses the daily reference rates, based on EUR", async () => {
    const source = new EcbSource(stub(async () => XML));
    const r = await source.fetch();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.source).toBe("ecb");
    expect(r.value.base).toBe("EUR");
    expect(r.value.date).toBe("2026-11-13");
    expect(r.value.rates).toContainEqual({ quote: "USD", rate: "1.1052" });
    expect(r.value.rates).toContainEqual({ quote: "MXN", rate: "20.5491" });
    expect(r.value.rates).toHaveLength(3);
  });

  it("is unavailable when the fetch throws", async () => {
    const source = new EcbSource(
      stub(async () => {
        throw new Error("network down");
      }),
    );
    const r = await source.fetch();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ExchangeRateSourceUnavailable");
  });

  it("is unavailable when the body has no rates", async () => {
    const source = new EcbSource(stub(async () => "<Envelope></Envelope>"));
    const r = await source.fetch();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("ExchangeRateSourceUnavailable");
  });
});
