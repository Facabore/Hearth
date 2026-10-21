import { describe, expect, it } from "vitest";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { whenLabel } from "./when-label";

const es = { today: "Hoy", yesterday: "Ayer", dayBeforeYesterday: "Anteayer" };
const norm = (text: string) => text.replace(/\s/g, " ");

describe("whenLabel (HU-E9-03)", () => {
  it("reads the day, a middle dot and the time in the person's format", () => {
    expect(
      whenLabel({ date: "2026-10-31", wall: { hour: 23, minute: 30 } }, "2026-10-31", BUILT_IN_FORMATS, es),
    ).toBe("Hoy · 23:30");
    const twelve = { ...BUILT_IN_FORMATS, timeFormat: "H12" as const };
    expect(
      norm(whenLabel({ date: "2026-10-15", wall: { hour: 19, minute: 0 } }, "2026-10-16", twelve, es)),
    ).toBe("Ayer · 7:00 PM");
    expect(
      whenLabel({ date: "2026-10-14", wall: { hour: 19, minute: 0 } }, "2026-10-16", BUILT_IN_FORMATS, es),
    ).toBe("Anteayer · 19:00");
    expect(
      whenLabel({ date: "2026-10-01", wall: { hour: 9, minute: 5 } }, "2026-10-16", BUILT_IN_FORMATS, es),
    ).toBe("1/10/2026 · 09:05");
  });
});
