import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { activityItemDto, cop, transactionDto } from "../../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { ActivityItemDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS, formatMoney } from "@/shared/ui/format/formatters";
import { SYMBOL_PATHS } from "@/shared/ui/icons/symbols";
import { UI_ICONS } from "@/shared/ui/icons/ui-icons";
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

  it("says 'pagaste tú' when she paid and is not in it, and never 'no te incluye' (P329)", () => {
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
    expect(lineOf("Regalo")).toBe("10 nov · Hogar · pagaste tú");
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
    // Ruling P329: the API no longer lists a movement without her; one that still arrived says who recorded it.
    expect(lineOf("Gas")).toBe("10 nov · Hogar · Juan registró");
    // Unsigned: no money of hers moved, and the words say so, never the grey alone.
    expect(screen.getByText(/45\.000/).textContent).toMatch(/^\$/);
  });

  it("names an older day as Movimientos' day label does: '10 nov', with the year outside today's (P324, P327)", () => {
    const on = (id: string, description: string, date: string) =>
      activityItemDto({
        transaction: transactionDto({ id, description, date, amount: cop(20_000) }),
        you: { memberIds: ["m-ana"], share: cop(10_000), paid: null },
      });
    renderRow(on("t-old", "Cine", "2026-11-10"));
    renderRow(on("t-older", "Pizza", "2025-11-10"));
    expect(lineOf("Cine")).toBe("10 nov · Hogar · tu parte");
    expect(lineOf("Pizza")).toBe("10 nov 2025 · Hogar · tu parte");
  });

  it("drops the day under Movimientos' day label and leaves the time to the detail, as her own rows do (P324)", () => {
    // Owner, 2026-11-15, on the account screen: "Sí, quítala"; a row stays two lines.
    renderRow(delivery, true);
    expect(lineOf("Domicilio")).toBe("Hogar · tu parte");
    // Only a record made in another zone still says when and where.
    renderRow(
      activityItemDto({
        transaction: transactionDto({
          id: "t-madrid",
          description: "Tapas",
          amount: cop(40_000),
          occurredAt: "2026-11-12T04:30:00.000Z",
          timeZone: "Europe/Madrid",
        }),
        you: { memberIds: ["m-ana"], share: cop(20_000), paid: null },
      }),
      true,
    );
    expect(lineOf("Tapas")).toBe("05:30 · Madrid · Hogar · tu parte");
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

describe('the round icon of a movement with no category (board "Cuenta · Movimientos · #315", P327)', () => {
  const iconPath = () => screen.getByRole("listitem").querySelector("svg[aria-hidden='true'] path");
  const transfer = (overrides: Parameters<typeof transactionDto>[0]) =>
    activityItemDto({
      transaction: transactionDto({
        type: "TRANSFER",
        description: "Movimiento",
        categoryId: null,
        payments: [],
        shares: [],
        sourceAccountId: "a-bank",
        destinationAccountId: "a-fund",
        ...overrides,
      }),
    });

  it("wears the swap arrows on a transfer between own accounts and the wallet on a contribution to the fund", () => {
    const own = renderRow(transfer({}), true);
    expect(iconPath()).toHaveAttribute("d", UI_ICONS.swap);
    own.unmount();
    renderRow(transfer({ payerMemberId: "m-juan" }), true);
    expect(iconPath()).toHaveAttribute("d", SYMBOL_PATHS.wallet);
  });
});

describe("money handed between Ana and someone else says whether it paid or lent (ruling P339, S9)", () => {
  /** A payment of `pesos` between Ana and Juan in Hogar, with the context the API gives it, if any. */
  const payment = (
    from: "m-ana" | "m-juan",
    pesos: number,
    settlement?: { kind: "PAID" | "LENT" | "PAID_AND_LENT"; paid: number; lent: number },
  ) =>
    activityItemDto({
      transaction: transactionDto({
        id: "t-pay",
        type: "SETTLEMENT",
        description: "",
        date: "2026-11-10",
        amount: cop(pesos),
        payerMemberId: from,
        receivingMemberId: from === "m-ana" ? "m-juan" : "m-ana",
      }),
      you: {
        memberIds: ["m-ana"],
        share: null,
        paid: null,
        ...(settlement
          ? { settlement: { kind: settlement.kind, paid: cop(settlement.paid), lent: cop(settlement.lent) } }
          : {}),
      },
      memberNames: { "m-ana": "Ana", "m-juan": "Juan" },
    });
  const titleOf = () => norm(screen.getByRole("link").querySelector(".truncate")!.textContent);

  it("says she paid Juan, or that he paid her, when it paid a debt", () => {
    const sent = renderRow(payment("m-ana", 30_000, { kind: "PAID", paid: 30_000, lent: 0 }));
    expect(titleOf()).toBe("Le pagaste a Juan");
    sent.unmount();
    renderRow(payment("m-juan", 30_000, { kind: "PAID", paid: 30_000, lent: 0 }));
    expect(titleOf()).toBe("Juan te pagó");
  });

  it("says she lent Juan, or that he lent her, when nobody owed it", () => {
    const sent = renderRow(payment("m-ana", 20_000, { kind: "LENT", paid: 0, lent: 20_000 }));
    expect(titleOf()).toBe("Le prestaste a Juan");
    expect(norm(screen.getByRole("listitem").textContent)).toBe(
      "Le prestaste a Juan10 nov · Hogar · Saldo entre ustedes−$ 20.000",
    );
    sent.unmount();
    renderRow(payment("m-juan", 20_000, { kind: "LENT", paid: 0, lent: 20_000 }));
    expect(titleOf()).toBe("Juan te prestó");
  });

  it("names both amounts, each on one line, when it went past the debt", () => {
    const sent = renderRow(payment("m-ana", 50_000, { kind: "PAID_AND_LENT", paid: 30_000, lent: 20_000 }));
    expect(titleOf()).toBe("Le pagaste $ 30.000 y le prestaste $ 20.000 a Juan");
    // AGENTS.md: an amount never breaks across lines, so a no-break space joins its symbol and digits.
    expect(screen.getByRole("link").textContent).toContain("$ 30.000");
    sent.unmount();
    renderRow(payment("m-juan", 50_000, { kind: "PAID_AND_LENT", paid: 30_000, lent: 20_000 }));
    expect(titleOf()).toBe("Juan te pagó $ 30.000 y te prestó $ 20.000");
  });

  it("keeps today's words without a context, and a description over any of them", () => {
    const sent = renderRow(payment("m-ana", 30_000));
    expect(titleOf()).toBe("Le pagaste a Juan");
    sent.unmount();
    const described = payment("m-ana", 20_000, { kind: "LENT", paid: 0, lent: 20_000 });
    renderRow({ ...described, transaction: { ...described.transaction, description: "Préstamo" } });
    expect(titleOf()).toBe("Préstamo");
  });

  it("says it in English too", () => {
    renderWithIntl(
      <ol>
        <ActivityRow
          item={payment("m-ana", 50_000, { kind: "PAID_AND_LENT", paid: 30_000, lent: 20_000 })}
          formats={BUILT_IN_FORMATS}
          viewerZone="America/Bogota"
          today="2026-11-13"
          money={(amount) => formatMoney(amount, BUILT_IN_FORMATS)}
        />
      </ol>,
      { locale: "en" },
    );
    expect(titleOf()).toBe("You paid Juan $ 30.000 and lent them $ 20.000");
  });
});
