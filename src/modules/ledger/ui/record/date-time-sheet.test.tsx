import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { DateTimeSheet } from "./date-time-sheet";

const at = (date: string, hour: number, minute: number) => ({ date, wall: { hour, minute } });
const open = (overrides: Partial<Parameters<typeof DateTimeSheet>[0]> = {}) => {
  const onApply = vi.fn();
  const { unmount } = renderWithIntl(
    <DateTimeSheet
      open
      onOpenChange={() => undefined}
      value={{ date: "2026-10-16", wall: { hour: 22, minute: 30 } }}
      now={{ date: "2026-10-16", wall: { hour: 22, minute: 30 } }}
      today="2026-10-16"
      formats={BUILT_IN_FORMATS}
      onApply={onApply}
      {...overrides}
    />,
  );
  return { onApply, unmount, sheet: screen.getByRole("dialog", { name: "Fecha y hora" }) };
};
const clockText = () => screen.getByRole("group", { name: "Hora" }).textContent?.replace(/\s+/g, " ").trim();

describe("date and time sheet (HU-E9-03, ruling P129)", () => {
  it("offers the quick days above a calendar that starts on the person's first weekday", async () => {
    const { sheet } = open();
    const days = within(sheet).getByRole("radiogroup", { name: "Día" });
    expect(
      within(days)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual([
      expect.stringContaining("Hoy"),
      expect.stringContaining("Ayer"),
      expect.stringContaining("Anteayer"),
    ]);
    const calendar = within(sheet).getByRole("grid", { name: "octubre de 2026" });
    expect(days.compareDocumentPosition(calendar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      within(calendar)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["L", "M", "M", "J", "V", "S", "D"]);
    expect(within(calendar).getByRole("button", { name: "17/10/2026" })).toBeDisabled();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("picks yesterday at 19:00 in two steps on a 24-hour clock", async () => {
    const { sheet, onApply } = open();
    await userEvent.click(within(sheet).getByRole("radio", { name: /Ayer/ }));
    for (let i = 0; i < 3; i += 1)
      await userEvent.click(within(sheet).getByRole("button", { name: "Una hora menos" }));
    await userEvent.click(within(sheet).getByRole("button", { name: ":00" }));
    expect(clockText()).toBe("19 : 00");
    await userEvent.click(within(sheet).getByRole("button", { name: /^Usar/ }));
    expect(onApply).toHaveBeenCalledWith({ date: "2026-10-15", wall: { hour: 19, minute: 0 } });
  });

  it("shows 7 : 00 with PM selected on a 12-hour clock", async () => {
    const { sheet } = open({
      formats: { ...BUILT_IN_FORMATS, timeFormat: "H12" },
      value: { date: "2026-10-15", wall: { hour: 19, minute: 0 } },
    });
    expect(clockText()).toContain("7 : 00");
    expect(within(sheet).getByRole("radio", { name: "PM" })).toBeChecked();
    await userEvent.click(within(sheet).getByRole("radio", { name: "AM" }));
    expect(clockText()).toContain("7 : 00");
  });

  it("steps a carried-over :32 to :35 or :30, and goes back to now", async () => {
    const { sheet } = open({ value: { date: "2026-10-16", wall: { hour: 22, minute: 32 } } });
    await userEvent.click(within(sheet).getByRole("button", { name: "Cinco minutos más" }));
    expect(clockText()).toBe("22 : 35");
    await userEvent.click(within(sheet).getByRole("button", { name: "Cinco minutos menos" }));
    expect(clockText()).toBe("22 : 30");
    await userEvent.click(within(sheet).getByRole("radio", { name: /Anteayer/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Ahora" }));
    expect(within(sheet).getByRole("radio", { name: /Hoy/ })).toBeChecked();
    expect(clockText()).toBe("22 : 30");
    expect(within(sheet).queryByRole("button", { name: /Sin hora/ })).toBeNull();
  });

  it("names the quick days across a month boundary and leaves them unchecked for an older day", async () => {
    const { sheet, onApply } = open({ today: "2026-11-01", value: at("2026-11-01", 9, 0) });
    const radios = within(within(sheet).getByRole("radiogroup", { name: "Día" })).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual([
      "Hoy1/11/2026",
      "Ayer31/10/2026",
      "Anteayer30/10/2026",
    ]);
    expect(radios[0]).toBeChecked();
    await userEvent.click(within(sheet).getByRole("radio", { name: /Anteayer/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: /^Usar/ }));
    expect(onApply).toHaveBeenLastCalledWith(at("2026-10-30", 9, 0));
    await userEvent.click(within(sheet).getByRole("button", { name: "Mes anterior" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "5/10/2026" }));
    for (const radio of radios) expect(radio).not.toBeChecked();
    await userEvent.click(within(sheet).getByRole("button", { name: /^Usar/ }));
    expect(onApply).toHaveBeenLastCalledWith(at("2026-10-05", 9, 0));
  });

  it("lays October 2026 out from the person's first weekday", () => {
    const firstWeek = () =>
      Array.from(screen.getByRole("grid").querySelectorAll("tbody tr")[0]!.querySelectorAll("td")).map(
        (cell) => cell.textContent,
      );
    const monday = open();
    expect(firstWeek()).toEqual(["", "", "", "1", "2", "3", "4"]);
    monday.unmount();
    open({ formats: { ...BUILT_IN_FORMATS, weekStart: "SUNDAY" } });
    expect(firstWeek()).toEqual(["", "", "", "", "1", "2", "3"]);
    const headers = within(screen.getByRole("grid")).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["D", "L", "M", "M", "J", "V", "S"]);
  });

  it("moves between months and across the year in both directions", async () => {
    const month = (name: string) => screen.getByRole("grid", { name });
    const press = (name: string) => userEvent.click(screen.getByRole("button", { name }));
    const december = open({ today: "2026-12-20", value: at("2026-12-05", 9, 0) });
    await press("Mes siguiente");
    expect(month("enero de 2027")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1/1/2027" })).toBeDisabled();
    await press("Mes anterior");
    await press("Mes anterior");
    expect(month("noviembre de 2026")).toBeInTheDocument();
    december.unmount();
    open({ value: at("2026-01-05", 9, 0) });
    await press("Mes anterior");
    expect(month("diciembre de 2025")).toBeInTheDocument();
  });

  it("wraps the clock inside the chosen day and never moves the day", async () => {
    const { sheet, onApply } = open({ value: at("2026-10-16", 23, 55) });
    await userEvent.click(within(sheet).getByRole("button", { name: "Cinco minutos más" }));
    expect(clockText()).toBe("00 : 00");
    await userEvent.click(within(sheet).getByRole("button", { name: "Una hora menos" }));
    expect(clockText()).toBe("23 : 00");
    await userEvent.click(within(sheet).getByRole("button", { name: /^Usar/ }));
    expect(onApply).toHaveBeenCalledWith(at("2026-10-16", 23, 0));
  });

  it("reads midnight and noon as 12, and applies the chosen half and minute shortcut, then closes", async () => {
    const twelve = { ...BUILT_IN_FORMATS, timeFormat: "H12" as const };
    const midnight = open({ formats: twelve, value: at("2026-10-15", 0, 5) });
    expect(clockText()).toContain("12 : 05");
    expect(within(midnight.sheet).getByRole("radio", { name: "AM" })).toBeChecked();
    await userEvent.click(within(midnight.sheet).getByRole("radio", { name: "PM" }));
    expect(clockText()).toContain("12 : 05");
    expect(within(midnight.sheet).getByRole("radio", { name: "PM" })).toBeChecked();
    midnight.unmount();
    const onOpenChange = vi.fn();
    const { sheet, onApply } = open({ onOpenChange, formats: twelve, value: at("2026-10-15", 19, 0) });
    await userEvent.click(within(sheet).getByRole("radio", { name: "AM" }));
    await userEvent.click(within(sheet).getByRole("button", { name: ":45" }));
    expect(within(sheet).getByRole("radio", { name: "AM" })).toBeChecked();
    expect(within(sheet).getByRole("button", { name: ":45" })).toHaveAttribute("aria-pressed", "true");
    const apply = within(sheet).getByRole("button", { name: /^Usar/ });
    expect(apply.textContent?.replace(/\s/g, " ")).toBe("Usar Ayer · 7:45 AM");
    await userEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith(at("2026-10-15", 7, 45));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("starts from the current value each time it opens", async () => {
    const props = {
      onOpenChange: () => undefined,
      value: at("2026-10-16", 22, 30),
      now: at("2026-10-16", 22, 30),
      today: "2026-10-16",
      formats: BUILT_IN_FORMATS,
      onApply: () => undefined,
    };
    const view = renderWithIntl(<DateTimeSheet open {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Una hora menos" }));
    expect(clockText()).toBe("21 : 30");
    view.rerender(<DateTimeSheet open={false} {...props} />);
    view.rerender(<DateTimeSheet open {...props} />);
    expect(clockText()).toBe("22 : 30");
  });
});
