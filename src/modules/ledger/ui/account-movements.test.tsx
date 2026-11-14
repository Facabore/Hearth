import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import {
  activityItemDto,
  categoryDto,
  cop,
  groupDto,
  normalized,
  transactionDto,
} from "../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import type { MyTransactionPageDto, TransactionPageDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { FundMovements, PersonalAccountMovements } from "./account-movements";
import type { RowContext } from "./transaction-row";

const NOVEMBER = { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" };
const TODAY = "2026-11-13";

const context = (overrides: Partial<RowContext> = {}): RowContext => ({
  formats: BUILT_IN_FORMATS,
  viewerZone: "America/Bogota",
  groups: [
    groupDto({
      id: "g-home",
      name: "Hogar",
      categories: [
        categoryDto({ id: "c-market", name: "Mercado" }),
        categoryDto({ id: "c-internet", name: "Servicios" }),
      ],
    }),
    groupDto({
      id: "g-work",
      name: "Trabajo",
      categories: [categoryDto({ id: "c-salary", name: "Trabajo" })],
    }),
  ],
  accountNames: { "a-bank": "Bancolombia", "a-savings": "Ahorros", "a-fund": "Fondo de Hogar" },
  memberNames: {},
  ...overrides,
});

const rowsOf = () => screen.getAllByRole("listitem").map((row) => normalized(row.textContent));

describe("a personal account's movements (ruling P327, board 'Cuenta · Movimientos · #315')", () => {
  /** Board A: Bancolombia's November across Ana's spaces. */
  const page: MyTransactionPageDto = {
    period: NOVEMBER,
    totals: { share: cop(0), income: cop(0) },
    nextCursor: null,
    items: [
      activityItemDto({
        transaction: transactionDto({
          id: "t-delivery",
          description: "Domicilio",
          date: "2026-11-12",
          amount: cop(64_000),
          payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(64_000) }],
        }),
        you: { memberIds: ["m-ana"], share: cop(32_000), paid: cop(64_000) },
      }),
      activityItemDto({
        space: { id: "sp-personal", name: "Personal", kind: "PERSONAL", color: "PINE" },
        transaction: transactionDto({
          id: "t-salary",
          type: "INCOME",
          description: "Salario noviembre",
          date: "2026-11-10",
          amount: cop(3_200_000),
          categoryId: "c-salary",
          destinationAccountId: "a-bank",
        }),
      }),
      activityItemDto({
        space: { id: "sp-personal", name: "Personal", kind: "PERSONAL", color: "PINE" },
        transaction: transactionDto({
          id: "t-savings",
          type: "TRANSFER",
          description: "A Ahorros",
          date: "2026-11-02",
          amount: cop(500_000),
          sourceAccountId: "a-bank",
          destinationAccountId: "a-savings",
        }),
      }),
    ],
  };

  it("signs each amount by what the account did, names her part of a Hogar expense once, and opens her own rows over the screen", async () => {
    const { container } = renderWithIntl(
      <PersonalAccountMovements
        page={page}
        period="2026-11"
        context={context()}
        today={TODAY}
        account={{ id: "a-bank", fund: false }}
        href="/spaces/sp-personal/accounts/a-bank"
      />,
    );
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => normalized(h.textContent))).toEqual([
      "Ayer · 12/11/2026",
      "10/11/2026",
      "2/11/2026",
    ]);
    expect(rowsOf()).toEqual([
      "DomicilioHogar · tu parte $ 32.000−$ 64.000",
      "Salario noviembreIngreso · Trabajo+$ 3.200.000",
      "A AhorrosTransferencia entre tus cuentas−$ 500.000",
    ]);
    expect(screen.getByRole("link", { name: /Salario noviembre/ })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts/a-bank?tx=t-salary",
    );
    // Another space's row opens the movement in its space, as the personal Movimientos does (P319).
    expect(screen.getByRole("link", { name: /Domicilio/ })).toHaveAttribute(
      "href",
      "/spaces/sp-hogar?tx=t-delivery",
    );
    // Money direction is never color alone: each amount carries its sign.
    expect(within(screen.getByRole("link", { name: /Salario/ })).getByText("+$ 3.200.000")).toHaveClass(
      "text-accent",
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("a shared fund's movements (ruling P327, board 'Fondo de Hogar · Movimientos · #315')", () => {
  /** Board C: what Fondo de Hogar paid and received in November. */
  const page: TransactionPageDto = {
    period: NOVEMBER,
    totals: { expenses: cop(0), income: cop(0) },
    nextCursor: null,
    items: [
      transactionDto({
        id: "t-market",
        description: "Mercado semanal",
        date: "2026-11-13",
        amount: cop(300_000),
        categoryId: "c-market",
        payments: [{ memberId: null, accountId: "a-fund", amount: cop(300_000) }],
      }),
      transactionDto({
        id: "t-juan",
        type: "TRANSFER",
        description: "Aporte de Juan",
        date: "2026-11-10",
        amount: cop(2_320_000),
        sourceAccountId: "a-juan-bank",
        destinationAccountId: "a-fund",
        payerMemberId: "m-juan",
      }),
      transactionDto({
        id: "t-ana",
        type: "TRANSFER",
        description: "Aporte de Ana (tú)",
        date: "2026-11-02",
        amount: cop(160_000),
        sourceAccountId: "a-ana-bank",
        destinationAccountId: "a-fund",
        payerMemberId: "m-ana",
      }),
    ],
  };

  it("reads 'pagó el fondo' with the category, and names where a contribution came from: her account, or the member", () => {
    renderWithIntl(
      <FundMovements
        spaceId="sp-hogar"
        page={page}
        period="2026-11"
        context={context({ memberNames: { "m-juan": "Juan", "m-ana": "Ana" }, viewerMemberId: "m-ana" })}
        today={TODAY}
        account={{ id: "a-fund", fund: true, ownAccountNames: { "a-ana-bank": "Bancolombia" } }}
        href="/spaces/sp-hogar/accounts/a-fund"
      />,
    );
    expect(rowsOf()).toEqual([
      "Mercado semanalpagó el fondo · Mercado−$ 300.000",
      "Aporte de JuanJuan → Fondo de Hogar+$ 2.320.000",
      "Aporte de Ana (tú)Bancolombia → Fondo de Hogar+$ 160.000",
    ]);
    expect(screen.getByRole("link", { name: /Mercado semanal/ })).toHaveAttribute(
      "href",
      "/spaces/sp-hogar/accounts/a-fund?tx=t-market",
    );
  });

  it("says the period has no movements when the account moved nothing", () => {
    renderWithIntl(
      <FundMovements
        spaceId="sp-hogar"
        page={{ ...page, items: [] }}
        period="2026-11"
        context={context()}
        today={TODAY}
        account={{ id: "a-fund", fund: true }}
        href="/spaces/sp-hogar/accounts/a-fund"
      />,
    );
    expect(screen.getByText("No hay movimientos en este período.")).toBeVisible();
  });
});
