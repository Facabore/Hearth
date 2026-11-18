import { describe, expect, it } from "vitest";
import { handleCandidate, parseHandle } from "./handle";

describe("parseHandle (P339)", () => {
  it("keeps 3 to 20 lower-case letters, digits and underscores", () => {
    expect(parseHandle("ana")).toEqual({ ok: true, value: "ana" });
    expect(parseHandle("fabian_2026")).toEqual({ ok: true, value: "fabian_2026" });
    expect(parseHandle("a".repeat(20))).toEqual({ ok: true, value: "a".repeat(20) });
  });

  it("reads upper case as lower case and drops spaces around it and one leading @", () => {
    expect(parseHandle("  @Fabian_B  ")).toEqual({ ok: true, value: "fabian_b" });
  });

  it("refuses anything shorter, longer or outside the set", () => {
    for (const raw of ["", "ab", "@ab", "a".repeat(21), "ana-maria", "ana maria", "añá", "@@ana", "ana.b"]) {
      expect(parseHandle(raw)).toMatchObject({ ok: false, error: { code: "InvalidHandle" } });
    }
  });
});

describe("handleCandidate (P343)", () => {
  it("is the name folded to a–z and 0–9, then an underscore and the digits", () => {
    expect(handleCandidate("Fabián", "4821")).toBe("fabian_4821");
    expect(handleCandidate("José Ñúñez", "0007")).toBe("josenunez_0007");
    expect(handleCandidate("ÁLVARO o'Brien-2", "1234")).toBe("alvaroobri_1234");
  });

  it("keeps at most 10 characters of the name", () => {
    expect(handleCandidate("Maximiliano Alejandro de la Santísima Trinidad", "9999")).toBe("maximilian_9999");
  });

  it("falls back to hearth when fewer than 3 characters remain", () => {
    expect(handleCandidate("李小龙", "1000")).toBe("hearth_1000");
    expect(handleCandidate("🙂🎉", "0000")).toBe("hearth_0000");
    expect(handleCandidate("Al", "5555")).toBe("hearth_5555");
    expect(handleCandidate("", "5555")).toBe("hearth_5555");
  });

  it("always passes parseHandle", () => {
    const names = ["Fabián", "José Ñúñez", "李小龙", "🙂", "Ana", "Al", "x".repeat(200), "Zoë 2026", "  "];
    for (const name of names) {
      const candidate = handleCandidate(name, "4821");
      expect(parseHandle(candidate)).toEqual({ ok: true, value: candidate });
    }
  });
});
