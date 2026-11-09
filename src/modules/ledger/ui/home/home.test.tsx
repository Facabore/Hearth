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
    expect(norm(summary.textContent)).toContain("Gastado en octubre");
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

  it("lets the keyboard reach and scroll the accounts strip, which overflows sideways with several accounts", async () => {
    renderWithIntl(
      <HomeSummary
        spaceId="sp-personal"
        today="2026-10-31"
        policy={{ kind: "MONTHLY", day: 1 }}
        page={{ ...octoberPage, items: [] }}
        accounts={["Efectivo", "Bancolombia", "Nequi", "Visa"].map((name, i) =>
          accountDto({ id: `a-${i}`, name, balance: cop(1) }),
        )}
        context={rowContext}
      />,
    );
    const strip = screen.getByRole("list", { name: "Cuentas" });
    await userEvent.tab();
    await userEvent.tab();
    expect(strip).toHaveFocus();
    // #223: it still scrolls sideways, without drawing a scrollbar on a phone (scrollbar-width, and WebKit's own).
    expect(strip).toHaveClass("overflow-x-auto", "[scrollbar-width:none]", "[&::-webkit-scrollbar]:hidden");
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

  it("shows one figure, her month, and its two parts closed: Solo tú and Con otros", async () => {
    const { container } = home();
    const summary = screen.getByRole("region", { name: "Resumen del período" });
    expect(norm(summary.textContent)).toContain("Gastado en octubre$ 725.000");
    const solo = within(summary).getByRole("button", { name: /Solo tú/ });
    const others = within(summary).getByRole("button", { name: /Con otros/ });
    expect(norm(solo.textContent)).toBe("Solo tú$ 245.000");
    expect(norm(others.textContent)).toBe("Con otros$ 480.000");
    expect(solo).toHaveAttribute("aria-expanded", "false");
    expect(others).toHaveAttribute("aria-expanded", "false");
    expect(within(summary).queryByText("Mercado")).not.toBeVisible();
    expect(screen.queryByRole("button", { name: "Lo que pagaste" })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("links to Mi consumo, which explains why her month is not what she paid (#287)", () => {
    // Audit pass 3, A7: since P306 nothing led to Mi consumo and its "¿Por qué es distinto?".
    renderWithIntl(
      <UnifiedSummary
        unified={unified}
        page={octoberPage}
        policy={{ kind: "MONTHLY", day: 1 }}
        formats={rowContext.formats}
        consumptionHref="/spaces/sp-personal/my-consumption?period=2026-10"
      />,
    );
    expect(screen.getByRole("link", { name: "¿Por qué no es lo que pagaste?" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/my-consumption?period=2026-10",
    );
  });

  it("opens Solo tú into her categories and Con otros into her groups, each named beside its color", async () => {
    const { container } = home();
    const summary = screen.getByRole("region", { name: "Resumen del período" });
    await userEvent.click(within(summary).getByRole("button", { name: /Solo tú/ }));
    const soloPanel = document.getElementById(
      within(summary)
        .getByRole("button", { name: /Solo tú/ })
        .getAttribute("aria-controls")!,
    )!;
    expect(within(summary).getByRole("button", { name: /Solo tú/ })).toHaveAttribute("aria-expanded", "true");
    expect(
      within(soloPanel)
        .getAllByRole("listitem")
        .map((row) => norm(row.textContent)),
    ).toEqual(["Mercado$ 150.000", "Restaurantes$ 60.000", "Transporte$ 35.000"]);
    await userEvent.click(within(summary).getByRole("button", { name: /Con otros/ }));
    const othersPanel = document.getElementById(
      within(summary)
        .getByRole("button", { name: /Con otros/ })
        .getAttribute("aria-controls")!,
    )!;
    expect(
      within(othersPanel)
        .getAllByRole("listitem")
        .map((row) => norm(row.textContent)),
    ).toEqual(["Hogar$ 410.000", "Viaje Cartagena$ 70.000"]);
    expect(othersPanel.querySelectorAll("[data-space-chip]")).toHaveLength(2);
    expect(await axeViolations(container)).toEqual([]);
    await userEvent.click(within(summary).getByRole("button", { name: /Solo tú/ }));
    expect(soloPanel).not.toBeVisible();
  });

  it("merges her spaces' movements into Recientes with their space, who recorded them and her part", () => {
    home();
    const rows = within(screen.getByRole("region", { name: "Recientes" })).getAllByRole("listitem");
    expect(rows).toHaveLength(5);
    expect(norm(rowOf("Mercado del mes").textContent)).toBe(
      "Mercado del mesHoyHogarJuan registró · tu parte $ 90.000 de $ 180.000−$ 90.000",
    );
    expect(within(rowOf("Mercado del mes")).getByRole("link")).toHaveAttribute(
      "href",
      "/spaces/sp-hogar?tx=t-hogar",
    );
    expect(norm(rowOf("Hotel").textContent)).toBe(
      "HotelAyerViaje CartagenaRegistraste tú · pagaste $ 210.000 · tu parte $ 70.000−$ 70.000",
    );
    expect(norm(rowOf("te pagó").textContent)).toBe(
      "Juan te pagó29/10/2026HogarSaldo entre ustedes+$ 50.000",
    );
    expect(norm(rowOf("Gas").textContent)).toBe("Gas28/10/2026HogarJuan registró · no te incluye$ 45.000");
    // Her own row is the one Inicio always drew, opening on her personal home.
    expect(within(rowOf("Salary")).getByRole("link")).toHaveAttribute(
      "href",
      "/spaces/sp-personal?tx=t-salary",
    );
  });

  it("keeps the old home without the unified month: no parts, only her own rows", () => {
    home({ summary: undefined, recent: undefined });
    expect(screen.queryByRole("button", { name: /Solo tú/ })).not.toBeInTheDocument();
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
    const amounts = [
      screen.getByRole("region", { name: "Resumen del período" }).querySelector("p.font-semibold"),
      screen.getByRole("region", { name: "Cuentas" }).querySelector("li span.font-semibold"),
    ];
    for (const amount of amounts) expect(amount).toHaveClass("[overflow-wrap:anywhere]");
    expect(amounts[0]?.className).toContain("clamp(");
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

describe("the home of a shared or direct space leads to its members (N10)", () => {
  const home = (
    kind: "PERSONAL" | "SHARED" | "DIRECT",
    role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" | null,
  ) =>
    renderWithIntl(
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

  it("shows Miembros and Invitar to someone who may invite, and Invitar opens the invite sheet", async () => {
    const { container } = home("SHARED", "OWNER");
    expect(screen.getByRole("link", { name: "Miembros" })).toHaveAttribute(
      "href",
      "/spaces/sp-shared/members",
    );
    expect(screen.getByRole("link", { name: "Invitar" })).toHaveAttribute(
      "href",
      "/spaces/sp-shared/members?invite=1",
    );
    for (const name of ["Miembros", "Invitar"])
      expect(screen.getByRole("link", { name })).toHaveClass("min-h-11");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows only Miembros to someone who may not invite, and in a direct space", () => {
    for (const [kind, role] of [
      ["SHARED", "MEMBER"],
      ["SHARED", "VIEWER"],
      ["DIRECT", "OWNER"],
    ] as const) {
      const { unmount } = home(kind, role);
      expect(screen.getByRole("link", { name: "Miembros" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Invitar" })).toBeNull();
      unmount();
    }
  });

  it("tells a Lector why there is no Registrar, and no one else (#290)", () => {
    // Audit pass 3, A16: the + and Invitar vanished for Sofi with no word about her role.
    const viewer = home("SHARED", "VIEWER");
    expect(
      screen.getByText("Eres Lector aquí: ves los movimientos y los saldos, pero no registras."),
    ).toBeInTheDocument();
    viewer.unmount();
    for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
      const { unmount } = home("SHARED", role);
      expect(screen.queryByText(/Eres Lector aquí/)).toBeNull();
      unmount();
    }
  });

  it("shows neither in a personal space", () => {
    home("PERSONAL", "OWNER");
    expect(screen.queryByRole("link", { name: "Miembros" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Invitar" })).toBeNull();
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

describe("the home of a shared or direct space explains its funds (U1)", () => {
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

  it("never asks a shared space for its first account: it explains, shows the period and offers a fund", async () => {
    const { container } = home("SHARED", "OWNER");
    expect(screen.queryByText("Agrega tu primera cuenta")).toBeNull();
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Resumen del período" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crear un fondo" })).toHaveAttribute(
      "href",
      "/spaces/sp-shared/accounts/new?returnTo=%2Fspaces%2Fsp-shared",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("offers no fund to someone who may not create one", () => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      const { unmount } = home("SHARED", role);
      expect(screen.getByText(NOTE)).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Crear un fondo" })).toBeNull();
      unmount();
    }
  });

  it("lists the funds it has, under a title for funds, and keeps the note", () => {
    home("SHARED", "OWNER", [accountDto({ name: "Fondo Hogar", type: "SHARED_FUND", balance: cop(0) })]);
    expect(screen.getByText(NOTE)).toBeInTheDocument();
    expect(norm(screen.getByRole("region", { name: "Fondos" }).textContent)).toContain("Fondo Hogar");
    expect(screen.queryByRole("link", { name: "Crear un fondo" })).toBeNull();
  });

  it("links its fund list under the name of a fund list (issue #178)", () => {
    home("SHARED", "MEMBER", [accountDto({ name: "Fondo Hogar", type: "SHARED_FUND", balance: cop(0) })]);
    expect(screen.getByRole("link", { name: "Ver todos los fondos" })).toHaveAttribute(
      "href",
      "/spaces/sp-shared/accounts",
    );
    expect(screen.queryByRole("link", { name: "Ver todas las cuentas" })).toBeNull();
  });

  it("says a direct space holds no accounts, and offers none", () => {
    home("DIRECT", "OWNER");
    expect(screen.queryByText("Agrega tu primera cuenta")).toBeNull();
    expect(screen.getByText(/cada una paga desde sus cuentas personales/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Crear un fondo" })).toBeNull();
  });

  it("still asks a personal space for its first account", () => {
    home("PERSONAL", "OWNER");
    expect(screen.getByText("Agrega tu primera cuenta")).toBeInTheDocument();
    expect(screen.queryByText(NOTE)).toBeNull();
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
    const owed = [
      { spaceId: "sp-household", space: "Household", amount: cop(311_400) },
      { spaceId: "sp-direct", space: "Ana & Mateo", amount: cop(30_000) },
    ];

    it("lists the bill, what she is owed and her turn, each with its way to act", async () => {
      const { container } = renderWithIntl(home({ needs: needs({ owes: [owe], pending: [energy], owed }) }));
      const card = await screen.findByRole("region", { name: "Te necesita hoy" });
      const rows = within(card)
        .getAllByRole("listitem")
        .map((row) => norm(row.textContent));
      expect(rows[0]).toContain("Energía por confirmar");
      expect(rows[0]).toContain("Household · hoy · sugerido $ 180.000");
      expect(rows[1]).toContain("Te deben $ 341.400");
      expect(rows[1]).toContain("Household $ 311.400 · Ana & Mateo $ 30.000");
      expect(rows[2]).toContain("Te toca poner $ 120.000");
      expect(within(card).getByRole("link", { name: "Revisar Energía en Household" })).toHaveAttribute(
        "href",
        "/spaces/sp-household/pending-occurrences",
      );
      // Saldos of the space that owes her the most.
      expect(within(card).getByRole("link", { name: "Ver lo que te deben" })).toHaveAttribute(
        "href",
        "/spaces/sp-household/balances",
      );
      expect(await axeViolations(container)).toEqual([]);
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
