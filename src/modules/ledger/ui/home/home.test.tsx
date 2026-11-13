import { screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import {
  accountDto,
  cop,
  octoberExpense,
  octoberPage,
  activityItemDto,
  rowContext,
  transactionDto,
} from "../../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { TransactionDetail } from "../detail/transaction-detail";
import { HomeSummary } from "./home-summary";
import { NeedsToday } from "./needs-today";
import { UnifiedRecent } from "./unified-home";
import { UnifiedSummary } from "./unified-summary";

// A row opens the detail sheet, which closes with the router.
const mocks = vi.hoisted(() => ({ router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

const norm = (text: string | null) => (text ?? "").replace(/\s/g, " ");

describe("home (HU-E9-01)", () => {
  it("shows the period's spending and income, the accounts and the latest transactions", async () => {
    const { container } = renderWithIntl(
      <HomeSummary
        spaceId="sp-personal"
        today="2026-10-31"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={{ ...octoberPage, items: octoberPage.items.slice(0, 3) }}
        accounts={[
          accountDto({ name: "Bancolombia", balance: cop(4_455_000) }),
          accountDto({ id: "a-2", name: "Nequi", balance: cop(500_000) }),
        ]}
        context={rowContext}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Inicio" })).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Resumen del período" });
    expect(norm(summary.textContent)).toContain("Gastaste en octubre");
    expect(norm(summary.textContent)).toContain("$ 245.000");
    expect(norm(summary.textContent)).toContain("+$ 3.200.000");
    expect(norm(screen.getByRole("region", { name: "Cuentas" }).textContent)).toContain(
      "Bancolombia$ 4.455.000",
    );
    expect(within(screen.getByRole("region", { name: "Recientes" })).getAllByRole("listitem")).toHaveLength(
      3,
    );
    expect(screen.getByRole("link", { name: "Ver todas las cuentas" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts",
    );
    expect(screen.getByRole("link", { name: "Ver todos los movimientos" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/transactions",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows one hero with no card around it, and no other figure at its size (P324)", async () => {
    const { container } = renderWithIntl(
      <HomeSummary
        spaceId="sp-personal"
        today="2026-10-31"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={{ ...octoberPage, items: octoberPage.items.slice(0, 3) }}
        accounts={[accountDto({ name: "Bancolombia", balance: cop(4_455_000) })]}
        context={rowContext}
      />,
    );
    const hero = screen.getByRole("region", { name: "Resumen del período" });
    expect(hero).not.toHaveClass("bg-surface");
    expect(hero).not.toHaveClass("rounded-2xl");
    expect(hero.parentElement).not.toHaveClass("bg-surface");
    expect(container.querySelectorAll("[data-hero-amount]")).toHaveLength(1);
    expect(norm(hero.querySelector("[data-hero-amount]")!.textContent)).toBe("$ 245.000");
    // Nothing on Inicio sits in a card: the hero, the accounts and Recientes are on the page.
    expect(container.querySelector(".rounded-2xl.bg-surface")).toBeNull();
  });

  it("lists only the accounts that hold money, as flat rows (P324)", () => {
    const { unmount } = renderWithIntl(
      <HomeSummary
        spaceId="sp-personal"
        today="2026-10-31"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={{ ...octoberPage, items: [] }}
        accounts={[
          accountDto({ id: "a-cash", name: "Efectivo", balance: cop(0) }),
          accountDto({ id: "a-bank", name: "Bancolombia", balance: cop(4_455_000) }),
          accountDto({ id: "a-nequi", name: "Nequi", balance: cop(0) }),
          accountDto({ id: "a-visa", name: "Visa", balance: cop(-120_000) }),
        ]}
        context={rowContext}
      />,
    );
    const list = screen.getByRole("list", { name: "Cuentas" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((row) => norm(row.textContent)),
    ).toEqual(["Bancolombia$ 4.455.000", "Visa−$ 120.000"]);
    expect(list).toHaveClass("divide-y");
    expect(list).not.toHaveClass("overflow-x-auto");
    for (const row of within(list).getAllByRole("listitem")) expect(row).toHaveClass("min-h-row");
    unmount();
    // Every account at zero: no rows, but the heading still leads to Cuentas (verifier B1), and no first-account card.
    renderWithIntl(
      <HomeSummary
        spaceId="sp-personal"
        today="2026-10-31"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={{ ...octoberPage, items: [] }}
        accounts={[accountDto({ id: "a-cash", name: "Efectivo", balance: cop(0) })]}
        context={rowContext}
      />,
    );
    expect(screen.queryByText("Efectivo")).toBeNull();
    expect(screen.getByRole("link", { name: "Ver todas las cuentas" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts",
    );
    expect(screen.queryByRole("region", { name: "Agrega tu primera cuenta" })).toBeNull();
  });
});

describe("the home's recent rows say which day they are from (#216, F10)", () => {
  const rows = () =>
    within(screen.getByRole("region", { name: /^(Recientes|Recent)$/ }))
      .getAllByRole("listitem")
      .map((row) => norm(row.textContent));
  const page = {
    ...octoberPage,
    items: [
      // 19:32 UTC is 14:32 in Bogotá, the viewer's zone, on October 13.
      octoberExpense("t-lunch", "Lunch", 30_000, "2026-10-13", "2026-10-13T19:32:00.000Z", "c-dining"),
      octoberExpense("t-market2", "Market", 100_000, "2026-10-12", "2026-10-12T23:02:00.000Z", "c-veg"),
      octoberExpense("t-market1", "Market", 85_000, "2026-10-05", "2026-10-05T13:10:00.000Z", "c-groceries"),
    ],
  };
  const home = (language: "es" | "en" = "es") =>
    renderWithIntl(
      <HomeSummary
        spaceId="sp-personal"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={page}
        accounts={[accountDto()]}
        context={rowContext}
        today="2026-10-13"
      />,
      { locale: language },
    );

  it("reads Hoy with the time today, Ayer yesterday, and the date before that, in the person's formats", () => {
    home();
    const [today, yesterday, lastWeek] = rows();
    expect(today).toContain("Lunch");
    expect(today).toContain("Hoy · 14:32 · ");
    expect(yesterday).toContain("Ayer · ");
    expect(yesterday).not.toContain("18:02");
    expect(lastWeek).toContain("5/10/2026 · ");
    expect(lastWeek).not.toContain("Hoy");
    expect(lastWeek).not.toContain("Ayer");
  });

  it("formats the date with the person's date format, never the language's", () => {
    renderWithIntl(
      <HomeSummary
        spaceId="sp-personal"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={page}
        accounts={[accountDto()]}
        context={{ ...rowContext, formats: { ...rowContext.formats, dateFormat: "YMD" } }}
        today="2026-10-13"
      />,
    );
    expect(rows()[2]).toContain("2026/10/5 · ");
  });

  it("speaks English in the English catalog", () => {
    home("en");
    const [today, yesterday] = rows();
    expect(today).toContain("Today · 14:32 · ");
    expect(yesterday).toContain("Yesterday · ");
  });
});

describe("the personal space shows everything (ruling P306)", () => {
  const unified = {
    consumed: cop(725_000),
    solo: {
      amount: cop(245_000),
      items: [
        { id: "c-market", name: "Mercado", color: "SAND" as const, amount: cop(150_000) },
        { id: "c-food", name: "Restaurantes", color: "ROSE" as const, amount: cop(60_000) },
        { id: "c-bus", name: "Transporte", color: null, amount: cop(35_000) },
      ],
    },
    withOthers: {
      amount: cop(480_000),
      items: [
        { id: "sp-hogar", name: "Hogar", color: "SKY" as const, amount: cop(410_000) },
        { id: "sp-viaje", name: "Viaje Cartagena", color: "PLUM" as const, amount: cop(70_000) },
      ],
    },
  };
  const groceries = activityItemDto({
    transaction: transactionDto({
      id: "t-hogar",
      description: "Mercado del mes",
      date: "2026-10-31",
      amount: cop(180_000),
      createdBy: "u-juan",
      payments: [{ memberId: "m-juan", accountId: null, amount: cop(180_000) }],
      shares: [
        { memberId: "m-juan", amount: cop(90_000), splitMethod: "EQUAL" },
        { memberId: "m-ana", amount: cop(90_000), splitMethod: "EQUAL" },
      ],
    }),
    recordedBy: { name: "Juan", you: false },
    you: { memberIds: ["m-ana"], share: cop(90_000), paid: null },
  });
  const hotel = activityItemDto({
    space: { id: "sp-viaje", name: "Viaje Cartagena", kind: "SHARED", color: "PLUM" },
    transaction: transactionDto({
      id: "t-hotel",
      description: "Hotel",
      date: "2026-10-30",
      amount: cop(210_000),
    }),
    recordedBy: { name: "Ana", you: true },
    you: { memberIds: ["m-ana-viaje"], share: cop(70_000), paid: cop(210_000) },
  });
  const settlement = activityItemDto({
    transaction: transactionDto({
      id: "t-settle",
      type: "SETTLEMENT",
      description: "",
      date: "2026-10-29",
      amount: cop(50_000),
      payerMemberId: "m-juan",
      receivingMemberId: "m-ana",
    }),
    memberNames: { "m-juan": "Juan", "m-ana": "Ana" },
  });
  const gas = activityItemDto({
    transaction: transactionDto({ id: "t-gas", description: "Gas", date: "2026-10-28", amount: cop(45_000) }),
    you: { memberIds: ["m-ana"], share: null, paid: null },
  });
  const feed = [
    { kind: "group" as const, item: groceries },
    { kind: "group" as const, item: hotel },
    { kind: "own" as const, tx: octoberPage.items[0]! },
    { kind: "group" as const, item: settlement },
    { kind: "group" as const, item: gas },
  ];
  // Inicio's route fills the two slots for the personal home of someone with other spaces.
  const home = (props: Partial<ComponentProps<typeof HomeSummary>> = {}) =>
    renderWithIntl(
      <HomeSummary
        spaceId="sp-personal"
        today="2026-10-31"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={octoberPage}
        accounts={[accountDto()]}
        context={rowContext}
        summary={
          <UnifiedSummary
            unified={unified}
            page={octoberPage}
            policy={{ kind: "MONTHLY", day: 1 }}
            formats={rowContext.formats}
          />
        }
        recent={<UnifiedRecent feed={feed} spaceId="sp-personal" context={rowContext} today="2026-10-31" />}
        {...props}
      />,
    );
  const rowOf = (name: string) =>
    within(screen.getByRole("region", { name: "Recientes" }))
      .getAllByRole("listitem")
      .find((row) => row.textContent?.includes(name))!;

  it("shows one hero, her month, and one line of what it holds, with no parts to open (P324)", async () => {
    const { container } = home();
    const summary = screen.getByRole("region", { name: "Resumen del período" });
    expect(norm(summary.textContent)).toBe(
      "Gastaste en octubre$ 725.000Incluye tu parte en 2 espacios. Solo tú $ 245.000 · con otros $ 480.000",
    );
    expect(summary).not.toHaveClass("bg-surface");
    expect(within(summary).queryByRole("button")).toBeNull();
    expect(within(summary).queryByText("Mercado")).toBeNull();
    expect(container.querySelectorAll("[data-hero-amount]")).toHaveLength(1);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("names the one space she shares, and opens Mi consumo from that line (#287)", () => {
    // Audit pass 3, A7: since P306 nothing led to Mi consumo and its "¿Por qué es distinto?".
    renderWithIntl(
      <UnifiedSummary
        unified={{
          ...unified,
          withOthers: { ...unified.withOthers, items: unified.withOthers.items.slice(0, 1) },
        }}
        page={octoberPage}
        policy={{ kind: "MONTHLY", day: 1 }}
        formats={rowContext.formats}
        consumptionHref="/spaces/sp-personal/my-consumption?period=2026-10"
      />,
    );
    const line = screen.getByRole("link", { name: /^Incluye tu parte en Hogar\./ });
    expect(norm(line.textContent)).toBe("Incluye tu parte en Hogar. Solo tú $ 245.000 · con otros $ 480.000");
    expect(line).toHaveAttribute("href", "/spaces/sp-personal/my-consumption?period=2026-10");
    expect(line).toHaveClass("min-h-11");
  });

  it("says her income instead when she shared nothing this month", () => {
    renderWithIntl(
      <UnifiedSummary
        unified={{ ...unified, withOthers: { amount: cop(0), items: [] } }}
        page={octoberPage}
        policy={{ kind: "MONTHLY", day: 1 }}
        formats={rowContext.formats}
        consumptionHref="/spaces/sp-personal/my-consumption?period=2026-10"
      />,
    );
    expect(screen.queryByText(/Incluye tu parte/)).toBeNull();
    expect(norm(screen.getByText(/^Ingresos/).textContent)).toBe("Ingresos +$ 3.200.000");
    // Mi consumo stays one tap away even in a month she shared nothing (verifier B2).
    expect(screen.getByRole("link", { name: /^Ingresos/ })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/my-consumption?period=2026-10",
    );
  });

  it("speaks English in the English catalog", () => {
    renderWithIntl(
      <UnifiedSummary
        unified={unified}
        page={octoberPage}
        policy={{ kind: "MONTHLY", day: 1 }}
        formats={rowContext.formats}
      />,
      { locale: "en" },
    );
    expect(norm(screen.getByRole("region", { name: "Period summary" }).textContent)).toBe(
      "Spent in October$ 725.000Includes your part in 2 spaces. Just you $ 245.000 · with others $ 480.000",
    );
  });

  it("merges her spaces' movements into Recientes with their space and her part, each said once (P324)", () => {
    home();
    const rows = within(screen.getByRole("region", { name: "Recientes" })).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    // Board "Inicio personal": "Ayer · Hogar · tu parte"; the amount is her part, so the line repeats no figure.
    expect(norm(rowOf("Mercado del mes").textContent)).toBe("Mercado del mesHoy · Hogar · tu parte−$ 90.000");
    expect(within(rowOf("Mercado del mes")).getByRole("link")).toHaveAttribute(
      "href",
      "/spaces/sp-hogar?tx=t-hogar",
    );
    expect(norm(rowOf("Hotel").textContent)).toBe("HotelAyer · Viaje Cartagena · tu parte−$ 70.000");
    expect(norm(rowOf("te pagó").textContent)).toBe(
      "Juan te pagó29/10/2026 · Hogar · Saldo entre ustedes+$ 50.000",
    );
    expect(norm(rowOf("Gas").textContent)).toBe("Gas28/10/2026 · Hogar · no te incluye$ 45.000");
    // Her own row is the one Inicio always drew, opening on her personal home.
    expect(within(rowOf("Salary")).getByRole("link")).toHaveAttribute(
      "href",
      "/spaces/sp-personal?tx=t-salary",
    );
  });

  it("shows a forgiven debt and a gift without a sign: no money moved (P322)", () => {
    const between = (id: string, settlementReason: "FORGIVENESS" | "GIFT", payer: string, receiver: string) =>
      activityItemDto({
        transaction: transactionDto({
          id,
          type: "SETTLEMENT",
          description: "",
          date: "2026-10-29",
          amount: cop(10_000),
          payerMemberId: payer,
          receivingMemberId: receiver,
          settlementReason,
        }),
        memberNames: { "m-juan": "Juan", "m-ana": "Ana", "m-luis": "Luis" },
      });
    const feedOf = (...items: ReturnType<typeof activityItemDto>[]) =>
      home({
        recent: (
          <UnifiedRecent
            feed={items.map((item) => ({ kind: "group" as const, item }))}
            spaceId="sp-personal"
            context={rowContext}
            today="2026-10-31"
          />
        ),
      });
    // Ana forgave Juan's debt; Luis forgave hers; Ana gave Juan what she paid for him; Luis gave her what he paid.
    feedOf(
      between("t-f1", "FORGIVENESS", "m-juan", "m-ana"),
      between("t-f2", "FORGIVENESS", "m-ana", "m-luis"),
      between("t-g1", "GIFT", "m-juan", "m-ana"),
      between("t-g2", "GIFT", "m-ana", "m-luis"),
      between("t-f3", "FORGIVENESS", "m-juan", "m-luis"),
    );
    const rows = within(screen.getByRole("region", { name: "Recientes" }))
      .getAllByRole("listitem")
      .map((row) => norm(row.textContent));
    expect(rows).toEqual([
      "Le perdonaste la deuda a Juan29/10/2026 · Hogar · No se movió dinero$ 10.000",
      "Luis te perdonó la deuda29/10/2026 · Hogar · No se movió dinero$ 10.000",
      "Se lo regalaste a Juan29/10/2026 · Hogar · No se movió dinero$ 10.000",
      "Luis te lo regaló29/10/2026 · Hogar · No se movió dinero$ 10.000",
      "Luis le perdonó la deuda a Juan29/10/2026 · Hogar · No se movió dinero$ 10.000",
    ]);
    const first = within(screen.getByRole("region", { name: "Recientes" })).getAllByRole("listitem")[0]!;
    const amount = [...first.querySelectorAll("span")].find((span) => norm(span.textContent) === "$ 10.000");
    expect(amount).toHaveClass("text-muted");
  });

  it("ends the personal Inicio with its plan as one line, after Recientes, never in the hero (P324)", () => {
    // Inicio's route fills the slot with the plan's line (`PlanCard`).
    home({ plan: <a href="/spaces/sp-personal/plan">Tu plan de octubre · Te quedan $ 1 de $ 2</a> });
    const plan = screen.getByRole("link", { name: /^Tu plan de octubre/ });
    expect(screen.getByRole("region", { name: "Recientes" }).compareDocumentPosition(plan)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const hero = screen.getByRole("region", { name: "Resumen del período" });
    expect(within(hero).queryByRole("link", { name: /plan/ })).toBeNull();
  });

  it("keeps the old home without the unified month: her income, only her own rows", () => {
    home({ summary: undefined, recent: undefined });
    expect(screen.queryByText(/Incluye tu parte/)).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Resumen del período" })).toHaveTextContent(/Ingresos/);
    expect(document.querySelector("[data-activity-row]")).toBeNull();
  });
});

describe("the home's recent rows open their detail (ruling P189)", () => {
  const recent = { ...octoberPage, items: octoberPage.items.slice(0, 3) };
  const summary = (props: Partial<ComponentProps<typeof HomeSummary>> = {}) => (
    <HomeSummary
      spaceId="sp-personal"
      today="2026-10-31"
      policy={{ kind: "MONTHLY", day: 1 }}
      page={recent}
      accounts={[accountDto({ name: "Bancolombia", balance: cop(1) })]}
      context={rowContext}
      {...props}
    />
  );

  it("wraps a long account name instead of cutting it (issue #178)", () => {
    renderWithIntl(
      summary({ accounts: [accountDto({ name: "Tarjeta de crédito Visa Oro", balance: cop(1) })] }),
    );
    const name = screen.getByText("Tarjeta de crédito Visa Oro");
    expect(name).not.toHaveClass("truncate");
    expect(name.className).toContain("[overflow-wrap:anywhere]");
  });

  it("links every recent row to the home's address with its transaction", () => {
    renderWithIntl(summary());
    const rows = within(screen.getByRole("region", { name: "Recientes" })).getAllByRole("listitem");
    expect(rows.map((row) => within(row).getByRole("link").getAttribute("href"))).toEqual([
      "/spaces/sp-personal?tx=t-salary",
      "/spaces/sp-personal?tx=t-dinner",
      "/spaces/sp-personal?tx=t-market2",
    ]);
  });

  it("opens the sheet for the transaction in the address and closes it to the plain home", async () => {
    const detail: TransactionDetail = {
      tx: octoberPage.items[1]!,
      problem: null,
      members: [],
      viewer: { userId: "u-ana", role: "OWNER", memberId: null },
      ownAccountNames: {},
    };
    renderWithIntl(summary({ detail }));
    expect(await screen.findByRole("dialog", { name: "Dinner" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(mocks.router.replace).toHaveBeenCalledWith("/spaces/sp-personal", { scroll: false });
  });

  it("opens no sheet without a transaction in the address", () => {
    renderWithIntl(summary());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("home without transactions (390 px review, S5)", () => {
  const empty = () =>
    renderWithIntl(
      <HomeSummary
        spaceId="sp-shared"
        today="2026-10-31"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={{ ...octoberPage, items: [] }}
        accounts={[accountDto({ name: "Fondo Hogar", balance: cop(0) })]}
        context={rowContext}
      />,
    );

  it("says there is nothing yet and how to record the first, instead of a bare heading", async () => {
    const { container } = empty();
    const recent = screen.getByRole("region", { name: "Recientes" });
    expect(
      within(recent).getByText("Aún no hay movimientos. Registra el primero con +."),
    ).toBeInTheDocument();
    expect(within(recent).queryAllByRole("listitem")).toEqual([]);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows no empty message once there is a transaction", () => {
    renderWithIntl(
      <HomeSummary
        spaceId="sp-personal"
        today="2026-10-31"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={{ ...octoberPage, items: octoberPage.items.slice(0, 1) }}
        accounts={[accountDto({ name: "Bancolombia", balance: cop(1) })]}
        context={rowContext}
      />,
    );
    expect(screen.queryByText(/Aún no hay movimientos/)).toBeNull();
  });
});

describe("home, narrow screens (S2)", () => {
  it("lets its single column shrink below its content, so a long name or amount never widens the page", () => {
    const { container } = renderWithIntl(
      <HomeSummary
        spaceId="sp-personal"
        today="2026-10-31"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={{ ...octoberPage, items: octoberPage.items.slice(0, 1) }}
        accounts={[accountDto({ name: "Cuenta de ahorros de la familia", balance: cop(4_455_000) })]}
        context={rowContext}
      />,
    );
    expect(container.firstElementChild).toHaveClass("grid-cols-1");
    expect(screen.getByRole("region", { name: "Cuentas" }).parentElement).toHaveClass("min-w-0");
    expect(screen.getByRole("region", { name: "Recientes" })).toHaveClass("min-w-0");
  });

  it("scales the period total down on a phone and lets any amount wrap, so a wide font never widens the page", () => {
    renderWithIntl(
      <HomeSummary
        spaceId="sp-personal"
        today="2026-10-31"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={{ ...octoberPage, items: [] }}
        accounts={[accountDto({ name: "Bancolombia", balance: cop(4_455_000) })]}
        context={rowContext}
      />,
    );
    const hero = screen
      .getByRole("region", { name: "Resumen del período" })
      .querySelector("[data-hero-amount]");
    expect(hero).toHaveClass("[overflow-wrap:anywhere]");
    expect(hero?.className).toContain("clamp(");
    // An account's amount never breaks across lines; its name wraps instead.
    const row = within(screen.getByRole("region", { name: "Cuentas" })).getByRole("listitem");
    expect(row.querySelector("span.font-semibold")).toHaveClass("whitespace-nowrap", "shrink-0");
    expect(within(row).getByText("Bancolombia")).toHaveClass("[overflow-wrap:anywhere]", "min-w-0");
  });
});

describe("home, first use (P148)", () => {
  const homeWith = (accounts: Parameters<typeof HomeSummary>[0]["accounts"]) => (
    <HomeSummary
      spaceId="sp-personal"
      today="2026-10-31"
      policy={{ kind: "MONTHLY", day: 1 }}
      page={{ ...octoberPage, items: [] }}
      accounts={accounts}
      context={rowContext}
    />
  );

  it("offers to add the first account in place of the period summary while the space has none", async () => {
    const { container } = renderWithIntl(homeWith([]));
    expect(screen.getByRole("heading", { level: 1, name: "Inicio" })).toBeInTheDocument();
    const card = screen.getByRole("region", { name: "Agrega tu primera cuenta" });
    expect(card).toHaveTextContent("Registra dónde tienes tu dinero para empezar a llevar tus cuentas.");
    // The card starts a flow: the accounts screen carries the home as the screen to return to after creating one.
    expect(within(card).getByRole("link", { name: "Ir a Cuentas" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts?returnTo=%2Fspaces%2Fsp-personal",
    );
    expect(screen.queryByRole("region", { name: "Resumen del período" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Cuentas" })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows the period summary and no card once an account exists", () => {
    renderWithIntl(homeWith([accountDto({ name: "Bancolombia", balance: cop(4_455_000) })]));
    expect(screen.getByRole("region", { name: "Resumen del período" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Agrega tu primera cuenta" })).not.toBeInTheDocument();
    expect(screen.queryByText("Agrega tu primera cuenta")).not.toBeInTheDocument();
  });

  it("speaks English in the English catalog", () => {
    renderWithIntl(homeWith([]), { locale: "en" });
    const card = screen.getByRole("region", { name: "Add your first account" });
    expect(card).toHaveTextContent("Record where your money is to start tracking it.");
    expect(within(card).getByRole("link", { name: "Go to Accounts" })).toBeInTheDocument();
  });
});

describe("the home of a shared or direct space carries no members pills (P324, supersedes N10's pills)", () => {
  // Ruling P324: Miembros and Invitar live behind the space's ⚙ Configuración, not on Inicio.
  it("shows no Miembros or Invitar link on any shared or direct home", () => {
    for (const [kind, role] of [
      ["SHARED", "OWNER"],
      ["SHARED", "MEMBER"],
      ["DIRECT", "OWNER"],
    ] as const) {
      const { unmount } = renderWithIntl(
        <HomeSummary
          spaceId="sp-shared"
          today="2026-10-31"
          kind={kind}
          role={role}
          policy={{ kind: "MONTHLY", day: 1 }}
          page={{ ...octoberPage, items: [] }}
          accounts={[]}
          context={rowContext}
        />,
      );
      expect(screen.queryByRole("link", { name: "Miembros" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Invitar" })).toBeNull();
      unmount();
    }
  });
});

describe("a shared space's Inicio (P324)", () => {
  const shared = (props: Partial<ComponentProps<typeof HomeSummary>> = {}) =>
    renderWithIntl(
      <HomeSummary
        spaceId="sp-hogar"
        today="2026-10-31"
        kind="SHARED"
        name="Hogar"
        role="MEMBER"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={octoberPage}
        accounts={[]}
        context={rowContext}
        {...props}
      />,
    );

  it("says the space spent it, and shows the plan line under the hero", () => {
    // Inicio's route fills the slot with the plan's hero line (`PlanCard`, variant "hero").
    shared({ plan: <a href="/spaces/sp-hogar/plan">de $ 4.000.000 del plan</a> });
    const hero = screen.getByRole("region", { name: "Resumen del período" });
    expect(hero).toHaveTextContent(/^Hogar gastó en octubre/);
    expect(within(hero).getByRole("link", { name: "de $ 4.000.000 del plan" })).toHaveAttribute(
      "href",
      "/spaces/sp-hogar/plan",
    );
    // The plan stands in for the income line; nothing else shows the plan.
    expect(within(hero).queryByText(/^Ingresos/)).toBeNull();
    expect(screen.getAllByRole("link", { name: /del plan/ })).toHaveLength(1);
  });

  it("says its income under the hero while it has no plan", () => {
    shared();
    const hero = screen.getByRole("region", { name: "Resumen del período" });
    expect(norm(within(hero).getByText(/^Ingresos/).textContent)).toBe("Ingresos +$ 3.200.000");
  });

  it("speaks English in the English catalog", () => {
    renderWithIntl(
      <HomeSummary
        spaceId="sp-hogar"
        today="2026-10-31"
        kind="SHARED"
        name="Hogar"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={octoberPage}
        accounts={[]}
        context={rowContext}
      />,
      { locale: "en" },
    );
    expect(screen.getByRole("region", { name: "Period summary" })).toHaveTextContent(
      /^Hogar spent in October/,
    );
  });
});

describe("home after accepting an invitation (U6)", () => {
  const home = (joined?: { space: string; dismissHref: string }) =>
    renderWithIntl(
      <HomeSummary
        spaceId="sp-shared"
        today="2026-10-31"
        kind="SHARED"
        role="MEMBER"
        joined={joined}
        policy={{ kind: "MONTHLY", day: 1 }}
        page={{ ...octoberPage, items: [] }}
        accounts={[]}
        context={rowContext}
      />,
    );

  it("welcomes the person once, naming the space", async () => {
    const { container } = home({ space: "Household", dismissHref: "/spaces/sp-shared" });
    expect(screen.getByRole("status")).toHaveTextContent("Te uniste a «Household»");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows nothing on a visit that did not come from accepting", () => {
    home();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("the home of a shared or direct space lists its funds (P324)", () => {
  // Ruling P324: the note about funds stays on Cuentas; Inicio lists the funds that hold money and links to them all.
  const NOTE = "Cada persona paga desde sus cuentas personales; aquí solo viven los fondos del espacio.";
  const home = (
    kind: "PERSONAL" | "SHARED" | "DIRECT",
    role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER",
    accounts = [] as ReturnType<typeof accountDto>[],
  ) =>
    renderWithIntl(
      <HomeSummary
        spaceId="sp-shared"
        today="2026-10-31"
        kind={kind}
        role={role}
        policy={{ kind: "MONTHLY", day: 1 }}
        page={octoberPage}
        accounts={accounts}
        context={rowContext}
      />,
    );

  it("never asks a shared space for its first account, and offers a fund as a quiet link", async () => {
    const { container } = home("SHARED", "OWNER");
    expect(screen.queryByText("Agrega tu primera cuenta")).toBeNull();
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(screen.getByRole("region", { name: "Resumen del período" })).toBeInTheDocument();
    const create = screen.getByRole("link", { name: "Crear un fondo" });
    expect(create).toHaveAttribute("href", "/spaces/sp-shared/accounts/new?returnTo=%2Fspaces%2Fsp-shared");
    expect(create).toHaveClass("min-h-11");
    expect(create).not.toHaveClass("bg-accent");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("offers no fund to someone who may not create one", () => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      const { unmount } = home("SHARED", role);
      expect(screen.queryByRole("link", { name: "Crear un fondo" })).toBeNull();
      unmount();
    }
  });

  it("lists the funds it has under a title for funds", () => {
    home("SHARED", "OWNER", [
      accountDto({ name: "Fondo Hogar", type: "SHARED_FUND", balance: cop(250_000) }),
    ]);
    expect(norm(screen.getByRole("region", { name: "Fondos" }).textContent)).toContain("Fondo Hogar");
    expect(screen.queryByRole("link", { name: "Crear un fondo" })).toBeNull();
  });

  it("leaves out a fund that holds nothing, keeps the link to the funds, and offers no new one (P324)", () => {
    home("SHARED", "OWNER", [accountDto({ name: "Fondo Hogar", type: "SHARED_FUND", balance: cop(0) })]);
    expect(screen.queryByText("Fondo Hogar")).toBeNull();
    expect(screen.getByRole("link", { name: "Ver todos los fondos" })).toHaveAttribute(
      "href",
      "/spaces/sp-shared/accounts",
    );
    expect(screen.queryByRole("link", { name: "Crear un fondo" })).toBeNull();
  });

  it("links its fund list under the name of a fund list (issue #178)", () => {
    home("SHARED", "MEMBER", [
      accountDto({ name: "Fondo Hogar", type: "SHARED_FUND", balance: cop(250_000) }),
    ]);
    expect(screen.getByRole("link", { name: "Ver todos los fondos" })).toHaveAttribute(
      "href",
      "/spaces/sp-shared/accounts",
    );
    expect(screen.queryByRole("link", { name: "Ver todas las cuentas" })).toBeNull();
  });

  it("offers a direct space no account", () => {
    home("DIRECT", "OWNER");
    expect(screen.queryByText("Agrega tu primera cuenta")).toBeNull();
    expect(screen.queryByRole("link", { name: "Crear un fondo" })).toBeNull();
  });

  it("still asks a personal space for its first account", () => {
    home("PERSONAL", "OWNER");
    expect(screen.getByText("Agrega tu primera cuenta")).toBeInTheDocument();
  });
});

describe("Inicio's turn to put money in and its eye (board B1 · 03, ruling P278)", () => {
  const owe = {
    spaceId: "sp-household",
    space: "Household",
    memberId: "m-ana",
    amount: cop(120_000),
    to: "Juan",
  };
  /** #288: Inicio's "Te necesita hoy", as the route fills HomeSummary's slot with it. */
  const needs = (props: Partial<ComponentProps<typeof NeedsToday>> = {}) => (
    <NeedsToday pending={[]} owed={[]} owes={[]} today="2026-10-31" formats={rowContext.formats} {...props} />
  );
  const home = (props: Partial<ComponentProps<typeof HomeSummary>> = {}) => (
    <HomeSummary
      spaceId="sp-personal"
      today="2026-10-31"
      policy={{ kind: "MONTHLY", day: 1 }}
      page={{ ...octoberPage, items: octoberPage.items.slice(0, 3) }}
      accounts={[accountDto({ name: "Bancolombia", balance: cop(4_455_000) })]}
      context={rowContext}
      {...props}
    />
  );

  it("says it is the person's turn to put money in a shared space, and Saldar opens Saldos' settle sheet", async () => {
    const { container } = renderWithIntl(home({ needs: needs({ owes: [owe] }) }));
    const card = await screen.findByRole("region", { name: "Te necesita hoy" });
    expect(norm(card.textContent)).toContain("Te toca poner $ 120.000 a Juan");
    expect(card).toHaveTextContent("En Household");
    const settle = within(card).getByRole("link", { name: "Saldar con Juan en Household" });
    expect(settle).toHaveTextContent("Saldar");
    expect(settle).toHaveAttribute("href", "/spaces/sp-household/balances?settle=m-ana");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("is one action line between two hairlines, never a card (P324)", async () => {
    renderWithIntl(home({ needs: needs({ owes: [owe] }) }));
    const line = await screen.findByRole("region", { name: "Te necesita hoy" });
    expect(line).toHaveClass("border-y");
    expect(line).not.toHaveClass("bg-surface");
    expect(within(line).getAllByRole("listitem")).toHaveLength(1);
    expect(within(line).queryByRole("button")).toBeNull();
    // It sits right under the hero, above Recientes.
    expect(
      screen.getByRole("region", { name: "Resumen del período" }).compareDocumentPosition(line) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(line.compareDocumentPosition(screen.getByRole("region", { name: "Recientes" }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("shows no such card when nothing needs the person", () => {
    renderWithIntl(home({ needs: needs() }));
    expect(screen.queryByRole("region", { name: "Te necesita hoy" })).not.toBeInTheDocument();
  });

  describe("Te necesita hoy gathers a bill to confirm and what she is owed too (#288)", () => {
    const energy = {
      spaceId: "sp-household",
      space: "Household",
      count: 1,
      name: "Energía",
      date: "2026-10-31",
      amount: cop(180_000),
    };
    it("reads 'Juan te debe $ 947.000 · Saldar' on Hogar's own Inicio, naming the figure once (P324)", async () => {
      renderWithIntl(
        needs({
          here: true,
          owed: [{ spaceId: "sp-household", space: "Hogar", amount: cop(947_000), from: "Juan" }],
        }),
      );
      const card = await screen.findByRole("region", { name: "Te necesita hoy" });
      expect(norm(within(card).getByRole("listitem").textContent)).toBe("Juan te debe $ 947.000Saldar");
      expect(within(card).getByRole("link", { name: "Saldar con Juan en Hogar" })).toHaveAttribute(
        "href",
        "/spaces/sp-household/balances",
      );
    });

    const owed = [
      { spaceId: "sp-household", space: "Household", amount: cop(311_400) },
      { spaceId: "sp-direct", space: "Ana & Mateo", amount: cop(30_000) },
    ];

    it("shows her turn as the one line, and the bill and what she is owed behind 2 más, each with its way to act", async () => {
      const { container } = renderWithIntl(home({ needs: needs({ owes: [owe], pending: [energy], owed }) }));
      const card = await screen.findByRole("region", { name: "Te necesita hoy" });
      expect(within(card).getAllByRole("listitem")).toHaveLength(1);
      expect(norm(within(card).getByRole("listitem").textContent)).toContain("Te toca poner $ 120.000");
      expect(within(card).queryByRole("link", { name: "Revisar Energía en Household" })).toBeNull();
      const more = within(card).getByRole("button", { name: "2 más" });
      expect(more).toHaveAttribute("aria-expanded", "false");
      expect(more).toHaveClass("min-h-11");
      await userEvent.click(more);
      expect(within(card).getByRole("button", { name: "Ver menos" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      const rows = within(card)
        .getAllByRole("listitem")
        .map((row) => norm(row.textContent));
      expect(rows).toHaveLength(3);
      expect(rows[0]).toContain("Te toca poner $ 120.000");
      expect(rows[1]).toContain("Energía por confirmar");
      expect(rows[1]).toContain("Household · hoy · sugerido $ 180.000");
      expect(rows[2]).toContain("Te deben $ 341.400");
      expect(rows[2]).toContain("Household $ 311.400 · Ana & Mateo $ 30.000");
      expect(within(card).getByRole("link", { name: "Revisar Energía en Household" })).toHaveAttribute(
        "href",
        "/spaces/sp-household/pending-occurrences",
      );
      // Every action is a full 44 × 44 target, the short "Saldar" included (AGENTS.md, UI).
      for (const name of [
        "Saldar con Juan en Household",
        "Revisar Energía en Household",
        "Saldar lo que te deben",
      ])
        expect(within(card).getByRole("link", { name })).toHaveClass("min-h-11", "min-w-11");
      // Saldos of the space that owes her the most.
      expect(within(card).getByRole("link", { name: "Saldar lo que te deben" })).toHaveAttribute(
        "href",
        "/spaces/sp-household/balances",
      );
      expect(await axeViolations(container)).toEqual([]);
    });

    it("leads with a bill to confirm when it is not her turn to put money in", async () => {
      renderWithIntl(home({ needs: needs({ pending: [energy], owed }) }));
      const card = await screen.findByRole("region", { name: "Te necesita hoy" });
      expect(norm(within(card).getByRole("listitem").textContent)).toContain("Energía por confirmar");
      expect(within(card).getByRole("button", { name: "1 más" })).toBeInTheDocument();
    });

    it("counts several bills of one space, and dates one from before today", async () => {
      renderWithIntl(home({ needs: needs({ pending: [{ ...energy, count: 2, date: "2026-10-28" }] }) }));
      const card = await screen.findByRole("region", { name: "Te necesita hoy" });
      expect(norm(card.textContent)).toContain("2 movimientos por confirmar");
      expect(norm(card.textContent)).toMatch(/Household · desde el 28\/10\/2026/);
    });

    it("leaves it all out of a period that already ended", () => {
      renderWithIntl(home({ needs: needs({ owes: [owe], pending: [energy], owed }), past: true }));
      expect(screen.queryByRole("region", { name: "Te necesita hoy" })).not.toBeInTheDocument();
    });
  });

  it("shows every amount, with no eye to hide them, whatever an older visit stored (ruling P311)", async () => {
    localStorage.setItem("hearth.hideAmounts.u-eye", "1");
    renderWithIntl(home({ needs: needs({ owes: [owe] }) }));
    expect(screen.queryByRole("button", { name: "Ocultar montos" })).toBeNull();
    expect(screen.getByRole("region", { name: "Resumen del período" })).toHaveTextContent("245.000");
    expect(await screen.findByRole("region", { name: "Te necesita hoy" })).toHaveTextContent("120.000");
    expect(document.body).not.toHaveTextContent("••••••");
    localStorage.clear();
  });

  it("draws Recientes as plain rows on the page, not in a card (B1 · 03)", () => {
    renderWithIntl(home());
    const list = within(screen.getByRole("region", { name: "Recientes" })).getByRole("list");
    expect(list).not.toHaveClass("bg-surface");
    expect(list).toHaveClass("divide-y");
  });
});
