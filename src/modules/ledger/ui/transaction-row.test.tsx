import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { categoryDto, cop, groupDto, transactionDto } from "../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import type { TransactionDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { TransactionRow, type RowContext } from "./transaction-row";

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
  it("keeps the amount whole and lets the text block shrink and truncate (S2)", () => {
    renderRow(dinner);
    const amount = screen.getByText(/60\.000/);
    expect(amount).toHaveClass("shrink-0", "whitespace-nowrap");
    expect(screen.getByText("Dinner")).toHaveClass("truncate");
    expect(screen.getByText("Dinner").parentElement).toHaveClass("min-w-0");
  });

  it("reads an expense: the record's wall-clock time, the category, the account and a minus sign", async () => {
    const { container } = renderRow(dinner);
    expect(rowText()).toBe("Dinner20:45 · Restaurants · Bancolombia−$ 60.000");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("names a subcategory with its parent", () => {
    renderRow({ ...dinner, categoryId: "c-veg" });
    expect(rowText()).toContain("20:45 · Groceries › Vegetables · Bancolombia");
  });

  it("shows the zone's city only when the record's zone differs from the viewer's", () => {
    renderRow({ ...dinner, occurredAt: "2026-11-01T04:30:00.000Z", timeZone: "Europe/Madrid" });
    expect(rowText()).toContain("05:30 · Madrid · Restaurants");
  });

  it("shows no time for a row without one, and the type when it has no description", () => {
    renderRow({ ...dinner, description: "", occurredAt: null, timeZone: null });
    expect(screen.getByRole("listitem")).not.toHaveTextContent(/\d{2}:\d{2}/);
    expect(rowText()).toBe("GastoRestaurants · Bancolombia−$ 60.000");
  });

  it("adds an income with a plus sign and the account that received it", () => {
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
    expect(rowText()).toBe("SalaryWages · Bancolombia+$ 3.200.000");
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
});
