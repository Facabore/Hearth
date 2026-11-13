import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { categoryDto, cop, groupDto, transactionDto } from "../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import type { TransactionDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { TransactionRow, type RowContext } from "./transaction-row";

// Exposes what the row passes to the link: opening a sheet must not scroll the list to its top.
vi.mock("next/link", () => ({
  default: ({ scroll, children, ...props }: { scroll?: boolean; children: ReactNode }) => (
    <a data-scroll={String(scroll)} {...props}>
      {children}
    </a>
  ),
}));

const norm = (text: string | null) => (text ?? "").replace(/\s/g, " ");

const context: RowContext = {
  formats: BUILT_IN_FORMATS,
  viewerZone: "America/Bogota",
  groups: [
    groupDto({
      id: "g-food",
      name: "Food",
      categories: [
        categoryDto({
          id: "c-groceries",
          name: "Groceries",
          subcategories: [categoryDto({ id: "c-veg", name: "Vegetables", parentCategoryId: "c-groceries" })],
        }),
        categoryDto({ id: "c-dining", name: "Restaurants" }),
      ],
    }),
    groupDto({
      id: "g-income",
      name: "Income",
      categories: [categoryDto({ id: "c-salary", name: "Wages" })],
    }),
  ],
  accountNames: { "a-bank": "Bancolombia", "a-visa": "Visa" },
  memberNames: {},
};

/** The row in its list, as the page renders it. */
const renderRow = (tx: TransactionDto, rowContext: RowContext = context) =>
  renderWithIntl(
    <ol>
      <TransactionRow tx={tx} context={rowContext} />
    </ol>,
  );
const rowText = () => norm(screen.getByRole("listitem").textContent);

const dinner = transactionDto({
  id: "t-dinner",
  description: "Dinner",
  amount: cop(60_000),
  date: "2026-10-12",
  categoryId: "c-dining",
  occurredAt: "2026-10-13T01:45:00.000Z",
  timeZone: "America/Bogota",
  payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(60_000) }],
});

describe("transaction row (HU-E9-03, ruling P140)", () => {
  it("is a link to its detail when given an href, named by its whole row (ruling P189)", async () => {
    const { container } = renderWithIntl(
      <ol>
        <TransactionRow tx={dinner} context={context} href="/spaces/s-1/transactions?tx=t-dinner" />
      </ol>,
    );
    const link = screen.getByRole("link", { name: /Dinner/ });
    expect(link).toHaveAttribute("href", "/spaces/s-1/transactions?tx=t-dinner");
    expect(norm(link.textContent)).toBe("Dinner20:45 · Restaurants−$ 60.000");
    expect(link.closest("li")).toBe(screen.getByRole("listitem"));
    expect(link).toHaveAttribute("data-scroll", "false");
    expect(link).toHaveClass("min-h-row-lg");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("has no link without an href, as before", () => {
    renderRow(dinner);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keeps the amount whole and lets the text block shrink and truncate (S2)", () => {
    renderRow(dinner);
    const amount = screen.getByText(/60\.000/);
    expect(amount).toHaveClass("shrink-0", "whitespace-nowrap");
    expect(screen.getByText("Dinner")).toHaveClass("truncate");
    expect(screen.getByText("Dinner").parentElement).toHaveClass("min-w-0");
  });

  it("reads an expense: the record's wall-clock time, the category and a minus sign, no account (board B1 03)", async () => {
    const { container } = renderRow(dinner);
    expect(rowText()).toBe("Dinner20:45 · Restaurants−$ 60.000");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("names a subcategory with its parent", () => {
    renderRow({ ...dinner, categoryId: "c-veg" });
    expect(rowText()).toBe("Dinner20:45 · Groceries › Vegetables−$ 60.000");
  });

  it("shows the zone's city only when the record's zone differs from the viewer's", () => {
    renderRow({ ...dinner, occurredAt: "2026-11-01T04:30:00.000Z", timeZone: "Europe/Madrid" });
    expect(rowText()).toContain("05:30 · Madrid · Restaurants");
  });

  it("shows no time for a row without one, and names an expense with no description by its category (#286)", () => {
    renderRow({ ...dinner, description: "", occurredAt: null, timeZone: null });
    expect(screen.getByRole("listitem")).not.toHaveTextContent(/\d{2}:\d{2}/);
    // Audit pass 3, A12: the category is the title, so a screen reader hears it too; the account takes its line.
    expect(rowText()).toBe("RestaurantsBancolombia−$ 60.000");
  });

  it("names a subcategorized expense with no description by its subcategory (#286)", () => {
    renderRow({ ...dinner, description: "", occurredAt: null, timeZone: null, categoryId: "c-veg" });
    expect(rowText()).toBe("VegetablesBancolombia−$ 60.000");
  });

  it("falls back to the type when an expense has neither a description nor a known category", () => {
    renderRow({ ...dinner, description: "", occurredAt: null, timeZone: null, categoryId: "c-gone" });
    expect(rowText()).toBe("GastoBancolombia−$ 60.000");
  });

  it("adds an income with a plus sign, named by its category", () => {
    renderRow(
      transactionDto({
        id: "t-salary",
        type: "INCOME",
        description: "Salary",
        amount: cop(3_200_000),
        categoryId: "c-salary",
        destinationAccountId: "a-bank",
      }),
    );
    expect(rowText()).toBe("SalaryWages+$ 3.200.000");
  });

  it("shows a transfer between its accounts, unsigned and without a category", () => {
    renderRow(
      transactionDto({
        id: "t-pay",
        type: "TRANSFER",
        description: "",
        amount: cop(200_000),
        sourceAccountId: "a-bank",
        destinationAccountId: "a-visa",
      }),
    );
    expect(rowText()).toBe("TransferenciaBancolombia → Visa$ 200.000");
  });

  it("names a deposit into the shared fund a contribution, never a transfer (#223)", () => {
    // HU-E4-09: the API answers a contribution as a TRANSFER that names its contributor in payerMemberId.
    renderRow(
      transactionDto({
        id: "t-fund",
        type: "TRANSFER",
        description: "",
        amount: cop(500_000),
        sourceAccountId: "a-bank",
        destinationAccountId: "a-fund",
        payerMemberId: "m-ana",
      }),
      { ...context, accountNames: { ...context.accountNames, "a-fund": "Fondo Hogar" } },
    );
    expect(rowText()).toBe("Aporte al fondoBancolombia → Fondo Hogar$ 500.000");
  });

  it("keeps a row whose category is unknown, with no category in its line", () => {
    renderRow({ ...dinner, categoryId: "c-gone" });
    expect(rowText()).toContain("20:45 · Bancolombia");
  });

  it("formats the amount and the time with the person's formats, never the language's", () => {
    renderRow(dinner, {
      ...context,
      formats: { ...BUILT_IN_FORMATS, numberFormat: "COMMA_DOT", timeFormat: "H12" },
    });
    expect(rowText()).toContain("8:45 PM · Restaurants");
    expect(rowText()).toContain("−$ 60,000");
  });

  it("is read-only: no edit, delete or any other control (ruling P140)", () => {
    renderRow(dinner);
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryAllByRole("link")).toEqual([]);
  });
  it("names who paid a shared expense and who paid whom in a settlement (ruling P171)", () => {
    const shared = {
      ...context,
      memberNames: { "m-ana": "Ana", "m-juan": "Juan" },
      accountNames: { "a-fund": "Fondo Hogar" },
    };
    const { unmount } = renderWithIntl(
      <ol>
        <TransactionRow
          tx={transactionDto({
            type: "EXPENSE",
            description: "Mercado",
            payments: [{ memberId: "m-juan", accountId: null, amount: cop(300_000) }],
          })}
          context={shared}
        />
      </ol>,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent("pagó Juan");
    unmount();
    const fundPaid = renderWithIntl(
      <ol>
        <TransactionRow
          tx={transactionDto({
            type: "EXPENSE",
            payments: [{ memberId: null, accountId: "a-fund", amount: cop(1) }],
          })}
          context={shared}
        />
      </ol>,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent("pagó Fondo Hogar");
    fundPaid.unmount();
    renderWithIntl(
      <ol>
        <TransactionRow
          tx={transactionDto({
            type: "SETTLEMENT",
            description: "",
            payerMemberId: "m-juan",
            receivingMemberId: "m-ana",
            amount: cop(100_000),
          })}
          context={shared}
        />
      </ol>,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent("Pago entre miembros");
    expect(screen.getByRole("listitem")).toHaveTextContent("Juan → Ana");
  });

  it("names the paying account once, and no payer, in a personal space's row", () => {
    renderWithIntl(
      <ol>
        <TransactionRow
          tx={transactionDto({
            type: "EXPENSE",
            description: "Mercado",
            payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(300_000) }],
          })}
          context={{ ...context, memberNames: {}, accountNames: { "a-bank": "Bancolombia" } }}
        />
      </ol>,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent("Bancolombia");
    expect(screen.getByRole("listitem")).not.toHaveTextContent("pagó");
  });

  it("names the payer of a shared expense instead of repeating the account, and a guest's payment too", () => {
    const shared = { ...context, memberNames: { "m-ana": "Ana", "m-pedro": "Pedro" } };
    renderWithIntl(
      <ol>
        <TransactionRow
          tx={transactionDto({
            type: "EXPENSE",
            payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(300_000) }],
          })}
          context={{ ...shared, accountNames: { "a-bank": "Bancolombia" } }}
        />
        <TransactionRow
          tx={transactionDto({
            id: "t-2",
            type: "EXPENSE",
            payments: [{ memberId: "m-pedro", accountId: null, amount: cop(1) }],
          })}
          context={shared}
        />
      </ol>,
    );
    const [mine, guest] = screen.getAllByRole("listitem");
    expect(mine).toHaveTextContent("pagó Ana");
    expect(mine).not.toHaveTextContent("Bancolombia");
    expect(guest).toHaveTextContent("pagó Pedro");
  });

  it("falls back to the paying account when the payer is no longer a member", () => {
    renderWithIntl(
      <ol>
        <TransactionRow
          tx={transactionDto({
            type: "EXPENSE",
            payments: [{ memberId: "m-gone", accountId: "a-bank", amount: cop(300_000) }],
          })}
          context={{ ...context, memberNames: { "m-ana": "Ana" }, accountNames: { "a-bank": "Bancolombia" } }}
        />
      </ol>,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent("Bancolombia");
    expect(screen.getByRole("listitem")).not.toHaveTextContent("pagó");
  });
  it("names the payer on the same line as the time, wrapping a long name rather than cut it (P284, S1)", () => {
    const shared = { ...context, memberNames: { "m-pedro": "Pedro (invitado)" } };
    renderWithIntl(
      <ol>
        <TransactionRow
          tx={transactionDto({
            type: "EXPENSE",
            description: "Mercado",
            categoryId: "c-dining",
            occurredAt: "2026-10-13T01:45:00.000Z",
            timeZone: "America/Bogota",
            payments: [{ memberId: "m-pedro", accountId: null, amount: cop(1) }],
          })}
          context={shared}
        />
      </ol>,
    );
    const line = screen.getByText("20:45 · pagó Pedro (invitado)");
    expect(line.closest(".truncate")).toBeNull();
    expect(line).toHaveClass("break-words");
  });

  it("names the account that received an income with no category, as board B1 03 does", () => {
    renderRow(
      transactionDto({
        id: "t-salary",
        type: "INCOME",
        description: "Salary",
        amount: cop(3_200_000),
        date: "2026-10-01",
        categoryId: null,
        destinationAccountId: "a-bank",
      }),
    );
    expect(rowText()).toBe("SalaryBancolombia+$ 3.200.000");
  });

  it("draws a round icon, as both lists do (boards B1 03 and E9-09 00)", () => {
    renderRow(dinner);
    const item = screen.getByRole("listitem");
    expect(item.querySelector(".rounded-full > [aria-hidden='true']")).not.toBeNull();
  });
});

/** The second line as it is seen: without what only a screen reader hears. */
const visibleLine = (title: string) => {
  const line = screen.getByText(title).nextElementSibling;
  if (!line) return null;
  const copy = line.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(".sr-only").forEach((node) => node.remove());
  return norm(copy.textContent);
};

/** Hogar's rows as Ana reads them (ruling P324). */
const hogar: RowContext = {
  ...context,
  memberNames: { "m-ana": "Ana", "m-juan": "Juan" },
  viewerMemberId: "m-ana",
};

describe("a row of Movimientos (board E9-09 00, ruling P284)", () => {
  const cardRow = (tx: TransactionDto, rowContext: RowContext = context) =>
    renderWithIntl(
      <ol>
        <TransactionRow tx={tx} context={rowContext} card />
      </ol>,
    );

  it("is a flat row, no card of its own, with a round icon and the time and account on its one line", async () => {
    const { container } = cardRow(dinner);
    const item = screen.getByRole("listitem");
    expect(item.className).not.toMatch(/\b(bg-|border|rounded-2xl|shadow|px-3)/);
    // Boards E9-09 00 and 12: "12:40 · Nequi"; the round icon shows the category, the line names none.
    const line = screen.getByText("20:45 · Bancolombia");
    expect(line).not.toHaveClass("truncate");
    expect(line).toHaveClass("break-words");
    expect(item.querySelector(".rounded-full > [aria-hidden='true']")).not.toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("reads its second line as the time and who paid, on one line: '9:15 · pagó Ana'", () => {
    cardRow(
      transactionDto({
        type: "EXPENSE",
        description: "Mercado",
        occurredAt: "2026-12-12T14:15:00.000Z",
        timeZone: "America/Bogota",
        payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(86_400) }],
      }),
      { ...context, memberNames: { "m-ana": "Ana" } },
    );
    const [, line, ...rest] = screen.getByText("Mercado").parentElement!.children;
    expect(line).toHaveTextContent(/^09:15 · pagó Ana$/);
    expect(rest).toEqual([]);
  });

  it("shows an income in green, with its plus sign", () => {
    cardRow(
      transactionDto({
        id: "t-salary",
        type: "INCOME",
        description: "Salary",
        amount: cop(3_200_000),
        categoryId: "c-salary",
        destinationAccountId: "a-bank",
      }),
    );
    expect(screen.getByText(/3\.200\.000/)).toHaveTextContent("+$");
    expect(screen.getByText(/3\.200\.000/)).toHaveClass("text-accent");
  });

  it("adds the viewer's share once after who paid: 'pagaste tú · tu parte $ 32.000' (board Movimientos, P324)", () => {
    cardRow(
      transactionDto({
        type: "EXPENSE",
        description: "Domicilio",
        amount: cop(64_000),
        payments: [{ memberId: "m-ana", accountId: null, amount: cop(64_000) }],
        shares: [
          { memberId: "m-ana", amount: cop(32_000), splitMethod: "EQUAL" },
          { memberId: "m-juan", amount: cop(32_000), splitMethod: "EQUAL" },
        ],
      }),
      hogar,
    );
    expect(visibleLine("Domicilio")).toBe("pagaste tú · tu parte $ 32.000");
    // The row's amount is the whole expense, with its sign; the share is never repeated.
    expect(norm(screen.getByRole("listitem").textContent)).toBe(
      "Domiciliopagaste tú · tu parte $ 32.000−$ 64.000",
    );
    expect(screen.getByRole("listitem").textContent!.match(/tu parte/g)).toHaveLength(1);
  });

  it("names another payer and the viewer's share, and no share when it is the whole amount or she is not in it", () => {
    renderWithIntl(
      <ol>
        <TransactionRow
          tx={transactionDto({
            id: "t-internet",
            description: "Internet",
            amount: cop(110_000),
            payments: [{ memberId: "m-juan", accountId: null, amount: cop(110_000) }],
            shares: [
              { memberId: "m-ana", amount: cop(55_000), splitMethod: "EQUAL" },
              { memberId: "m-juan", amount: cop(55_000), splitMethod: "EQUAL" },
            ],
          })}
          context={hogar}
          card
        />
        <TransactionRow
          tx={transactionDto({
            id: "t-mine",
            description: "Solo mío",
            amount: cop(20_000),
            payments: [{ memberId: "m-ana", accountId: null, amount: cop(20_000) }],
            shares: [{ memberId: "m-ana", amount: cop(20_000), splitMethod: "EQUAL" }],
          })}
          context={hogar}
          card
        />
        <TransactionRow
          tx={transactionDto({
            id: "t-his",
            description: "Solo de Juan",
            amount: cop(15_000),
            payments: [{ memberId: "m-juan", accountId: null, amount: cop(15_000) }],
            shares: [{ memberId: "m-juan", amount: cop(15_000), splitMethod: "EQUAL" }],
          })}
          context={hogar}
          card
        />
      </ol>,
    );
    expect(visibleLine("Internet")).toBe("pagó Juan · tu parte $ 55.000");
    expect(visibleLine("Solo mío")).toBe("pagaste tú");
    expect(visibleLine("Solo de Juan")).toBe("pagó Juan");
  });

  it("names no share without the viewer's member, as a personal space's rows are", () => {
    cardRow(
      transactionDto({
        description: "Domicilio",
        amount: cop(64_000),
        payments: [{ memberId: "m-ana", accountId: null, amount: cop(64_000) }],
        shares: [{ memberId: "m-ana", amount: cop(32_000), splitMethod: "EQUAL" }],
      }),
      { ...hogar, viewerMemberId: undefined },
    );
    expect(visibleLine("Domicilio")).toBe("pagó Ana");
  });
});

describe("medium density (ruling P324)", () => {
  it("draws Inicio de Hogar's row as its board: 'Ayer · pagaste tú', the whole amount with its sign", () => {
    renderWithIntl(
      <ol>
        <TransactionRow
          tx={transactionDto({
            description: "Domicilio",
            date: "2026-11-12",
            amount: cop(64_000),
            categoryId: "c-dining",
            payments: [{ memberId: "m-ana", accountId: null, amount: cop(64_000) }],
            shares: [
              { memberId: "m-ana", amount: cop(32_000), splitMethod: "EQUAL" },
              { memberId: "m-juan", amount: cop(32_000), splitMethod: "EQUAL" },
            ],
          })}
          context={hogar}
          today="2026-11-13"
          href="/spaces/sp-hogar?tx=t-1"
        />
      </ol>,
    );
    expect(visibleLine("Domicilio")).toBe("Ayer · pagaste tú");
    // Inicio names no share: the line says who paid, the amount is the expense.
    expect(screen.getByText(/64\.000/)).toHaveTextContent("−$ 64.000");
    expect(screen.getByRole("link", { name: /Domicilio/ })).toHaveAttribute(
      "href",
      "/spaces/sp-hogar?tx=t-1",
    );
  });

  it("states the category once, by its icon, and still to a screen reader", () => {
    renderRow(dinner);
    expect(visibleLine("Dinner")).toBe("20:45");
    const hidden = screen.getByRole("listitem").querySelector(".sr-only");
    expect(norm(hidden!.textContent)).toBe(" · Restaurants");
    // A row titled by its category names no category again, not even to a screen reader.
    renderRow({ ...dinner, id: "t-2", description: "", occurredAt: null, timeZone: null });
    expect(screen.getAllByRole("listitem")[1]!.querySelector(".sr-only")).toBeNull();
  });

  it("keeps a category for a screen reader when the row has no visible second line", () => {
    renderRow({ ...dinner, occurredAt: null, timeZone: null });
    expect(screen.getByText("Dinner").nextElementSibling).toHaveClass("sr-only");
    expect(screen.getByText("Dinner").nextElementSibling).toHaveTextContent("Restaurants");
  });

  it("is 56 px with two lines and 48 px with one, never below a 44 px target", () => {
    renderWithIntl(
      <ol>
        <TransactionRow tx={dinner} context={context} href="/spaces/s-1?tx=t-dinner" />
        <TransactionRow
          tx={{ ...dinner, id: "t-2", description: "Lunch", occurredAt: null, timeZone: null }}
          context={context}
          href="/spaces/s-1?tx=t-2"
        />
      </ol>,
    );
    expect(screen.getByRole("link", { name: /Dinner/ })).toHaveClass("min-h-row-lg");
    expect(screen.getByRole("link", { name: /Lunch/ })).toHaveClass("min-h-row");
    expect(screen.getByRole("link", { name: /Lunch/ })).not.toHaveClass("min-h-row-lg");
  });

  it("reads a 16 px title, a 13 px muted line and a 16 px semibold amount beside a 36 px icon, in both lists", () => {
    for (const card of [false, true]) {
      const { unmount } = renderWithIntl(
        <ol>
          <TransactionRow tx={dinner} context={context} card={card} />
        </ol>,
      );
      expect(screen.getByText("Dinner")).toHaveClass("truncate", "text-base", "text-ink");
      expect(screen.getByText("Dinner").nextElementSibling).toHaveClass("text-[13px]", "text-muted");
      expect(screen.getByText(/60\.000/)).toHaveClass("text-base", "font-semibold", "whitespace-nowrap");
      expect(screen.getByRole("listitem").querySelector("[aria-hidden='true']")).toHaveStyle({
        width: "36px",
      });
      unmount();
    }
  });
});
