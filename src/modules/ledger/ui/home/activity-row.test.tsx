import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { activityItemDto, cop, transactionDto } from "../../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { ActivityItemDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS, formatMoney } from "@/shared/ui/format/formatters";
import { ActivityRow } from "./activity-row";

const norm = (text: string | null) => (text ?? "").replace(/\s/g, " ");

/** Juan's Domicilio in Hogar, split in two; Ana paid it. */
const delivery = activityItemDto({
  transaction: transactionDto({
    id: "t-delivery",
    description: "Domicilio",
    date: "2026-11-12",
    amount: cop(64_000),
    occurredAt: "2026-11-12T19:30:00.000Z",
    timeZone: "America/Bogota",
  }),
  recordedBy: { name: "Juan", you: false },
  you: { memberIds: ["m-ana"], share: cop(32_000), paid: cop(64_000) },
});

const renderRow = (item: ActivityItemDto, card = false) =>
  renderWithIntl(
    <ol>
      <ActivityRow
        item={item}
        formats={BUILT_IN_FORMATS}
        viewerZone="America/Bogota"
        today="2026-11-13"
        money={(amount) => formatMoney(amount, BUILT_IN_FORMATS)}
        card={card}
      />
    </ol>,
  );
const lineOf = (title: string) => norm(screen.getByText(title).nextElementSibling!.textContent);

describe("another space's row (ruling P306, medium density P324)", () => {
  it("reads 'Ayer · Hogar · tu parte': its day, its space and her part, each once", async () => {
    const { container } = renderRow(delivery);
    expect(lineOf("Domicilio")).toBe("Ayer · Hogar · tu parte");
    const text = norm(screen.getByRole("listitem").textContent);
    expect(text).toBe("DomicilioAyer · Hogar · tu parte−$ 32.000");
    // The figure is the amount alone; neither the total, what she paid nor who recorded it repeats it.
    expect(text.match(/\$/g)).toHaveLength(1);
    expect(text).not.toContain("registr");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("names the space in words, never by its color alone, and keeps the row's link", () => {
    renderRow(delivery);
    const space = screen.getByText("Hogar");
    expect(space).toHaveAttribute("data-space-chip");
    expect(space.getAttribute("style")).toBeNull();
    expect(screen.getByRole("link", { name: /Domicilio/ })).toHaveAttribute(
      "href",
      "/spaces/sp-hogar?tx=t-delivery",
    );
  });

  it("is one flat two-line row: no card, a 13 px line, a 16 px semibold amount that never wraps", () => {
    renderRow(delivery);
    const link = screen.getByRole("link", { name: /Domicilio/ });
    expect(link).toHaveClass("min-h-row-lg");
    expect(link.className).not.toMatch(/\b(bg-|border|shadow|px-3)/);
    expect(screen.getByText("Domicilio")).toHaveClass("truncate", "text-base");
    expect(screen.getByText("Domicilio").parentElement!.children).toHaveLength(2);
    expect(screen.getByText("Domicilio").nextElementSibling).toHaveClass("text-[13px]", "text-muted");
    expect(screen.getByText(/32\.000/)).toHaveClass("text-base", "font-semibold", "whitespace-nowrap");
    expect(screen.getByRole("listitem").querySelector("[aria-hidden='true']")).toHaveClass("size-9");
  });

  it("says 'pagaste tú' when she paid and is not in it, and 'no te incluye' when she is in neither", () => {
    renderRow(
      activityItemDto({
        transaction: transactionDto({
          id: "t-paid",
          description: "Regalo",
          date: "2026-11-10",
          amount: cop(40_000),
        }),
        you: { memberIds: ["m-ana"], share: null, paid: cop(40_000) },
      }),
    );
    expect(lineOf("Regalo")).toBe("10/11/2026 · Hogar · pagaste tú");
    expect(screen.getByText(/40\.000/)).toHaveTextContent("−$ 40.000");
    renderRow(
      activityItemDto({
        transaction: transactionDto({
          id: "t-gas",
          description: "Gas",
          date: "2026-11-10",
          amount: cop(45_000),
        }),
        you: { memberIds: ["m-ana"], share: null, paid: null },
      }),
    );
    expect(lineOf("Gas")).toBe("10/11/2026 · Hogar · no te incluye");
  });

  it("drops the day under Movimientos' day label and keeps the time", () => {
    renderRow(delivery, true);
    expect(lineOf("Domicilio")).toBe("14:30 · Hogar · tu parte");
    renderRow(
      activityItemDto({
        transaction: transactionDto({ id: "t-2", description: "Sin hora", amount: cop(10_000) }),
        you: { memberIds: ["m-ana"], share: cop(5_000), paid: null },
      }),
      true,
    );
    expect(lineOf("Sin hora")).toBe("Hogar · tu parte");
  });
});
