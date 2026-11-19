import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../../tests/support/ui/dto";
import {
  e7Fund,
  HOUSEHOLD_MEMBERS,
  householdDto,
  spaceMemberDto,
} from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { FundTracking } from "./fund-tracking";

vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

const show = (fund = e7Fund(), members = HOUSEHOLD_MEMBERS) =>
  renderWithIntl(
    <FundTracking fund={fund} members={members} space={householdDto()} formats={BUILT_IN_FORMATS} />,
  );
const card = (name: string) => normalized(screen.getByRole("listitem", { name }).textContent);

describe("fund tracking (HU-E9-10)", () => {
  it("shows Juan expected 720.000, actual 500.000 and difference −220.000", async () => {
    const { container } = show();
    const juan = card("Juan");
    expect(juan).toContain("Esperado720.000 COP");
    expect(juan).toContain("Aportado500.000 COP");
    expect(juan).toContain("Diferencia−\u2060220.000 COP");
    expect(juan).toContain("Le faltan 220.000 COP para el fondo");
    expect(card("Ana")).toContain("Al día con el fondo");
    expect(screen.queryByText("Sin plan, nadie tiene un aporte esperado.")).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("sums nothing itself: the summary is the API's totals (ruling P201)", () => {
    const totals = { expected: cop(7), actual: cop(8), difference: cop(9) };
    show(e7Fund({ totals }));
    const summary = normalized(screen.getByRole("region", { name: "Aportes al fondo" }).textContent);
    expect(summary).toContain("Esperado7 COP");
    expect(summary).toContain("Aportado8 COP");
    expect(summary).toContain("Diferencia+9 COP");
  });

  it("calls a member who paid more than expected up to date, and reads the sign of their difference", () => {
    const members = [
      { memberId: "m-ana", expected: cop(480_000), actual: cop(530_000), difference: cop(50_000) },
      { memberId: "m-juan", expected: cop(100_000), actual: cop(100_000), difference: cop(0) },
    ];
    show(e7Fund({ members }));
    expect(card("Ana")).toContain("Diferencia+50.000 COP");
    expect(card("Ana")).toContain("Al día con el fondo");
    expect(card("Juan")).toContain("Diferencia0 COP");
    expect(card("Juan")).toContain("Al día con el fondo");
    expect(card("Juan")).not.toContain("Le faltan");
  });

  it("draws the summary as three tiles, the one still missing tinted and named Falta (board E9-10 04, ruling P272)", () => {
    show();
    const summary = screen.getByRole("region", { name: "Aportes al fondo" });
    const tiles = [...summary.querySelectorAll("dl > div")];
    expect(tiles.map((tile) => normalized(tile.textContent))).toEqual([
      "Esperado1.200.000 COP",
      "Aportado980.000 COP",
      "Falta220.000 COP",
    ]);
    expect(tiles[2]).toHaveClass("bg-owe-soft");
    expect(tiles[0]).not.toHaveClass("bg-owe-soft");
  });

  it("puts a member's expected, contributed and difference on one row of three, the difference at the right", () => {
    show();
    const figures = screen.getByRole("listitem", { name: "Juan" }).querySelector("dl")!;
    // Three equal columns while they fit; a figure that does not fit moves to the next row instead of breaking.
    expect(figures).toHaveClass("flex", "flex-wrap");
    expect([...figures.children].every((figure) => figure.classList.contains("flex-1"))).toBe(true);
    expect(figures.querySelector("[data-field='difference']")!.parentElement).toHaveClass("text-right");
  });

  it("never breaks an amount across lines: the tiles and a member's figures wrap whole instead (AGENTS.md)", async () => {
    // Nine-digit amounts, wider than a third of a 320 px phone.
    const members = [
      {
        memberId: "m-ana",
        expected: cop(123_456_789),
        actual: cop(100_000_000),
        difference: cop(-23_456_789),
      },
      { memberId: "m-juan", expected: cop(100_000_000), actual: cop(100_000_000), difference: cop(0) },
    ];
    const totals = { expected: cop(223_456_789), actual: cop(200_000_000), difference: cop(-23_456_789) };
    show(e7Fund({ members, totals }));
    const summary = screen.getByRole("region", { name: "Aportes al fondo" });
    expect(summary.querySelector("dl")).toHaveClass("flex", "flex-wrap");
    const ana = screen.getByRole("listitem", { name: "Ana" });
    const figures = [...summary.querySelectorAll("dd"), ...ana.querySelectorAll("dd")];
    expect(figures).toHaveLength(6);
    for (const figure of figures) {
      expect(figure).toHaveClass("whitespace-nowrap", "tabular-nums");
      expect(figure.className).not.toContain("overflow-wrap");
    }
    // The member's detail: the hero and every row's amount keep to one line too.
    await userEvent.click(screen.getByRole("button", { name: "Ver lo que le toca a Ana" }));
    const sheet = await screen.findByRole("dialog", { name: "Ana · noviembre" });
    const amounts = [...sheet.querySelectorAll("[data-amount]")];
    expect(amounts.map((amount) => normalized(amount.textContent))).toEqual([
      "123.456.789 COP",
      "123.456.789 COP",
      "23.456.789 COP",
    ]);
    for (const amount of amounts) {
      expect(amount).toHaveClass("whitespace-nowrap");
      expect(amount.className).not.toContain("overflow-wrap");
    }
  });

  it("fills each member's bar with what they contributed of what was expected, and draws it for nobody's ears", () => {
    const { container } = show();
    expect(container.querySelector("[data-member='m-juan'] [data-bar]")).toHaveStyle({ width: "69%" });
    expect(container.querySelector("[data-member='m-ana'] [data-bar]")).toHaveStyle({ width: "100%" });
    for (const bar of container.querySelectorAll("[data-bar]")) {
      expect(bar.parentElement).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("writes an amount still owed in the owe ink, never in the owe color that fails AA at body size", () => {
    show();
    const difference = (name: string) =>
      screen.getByRole("listitem", { name }).querySelector("[data-field='difference']") as HTMLElement;
    expect(difference("Juan")).toHaveClass("text-owe-ink");
    expect(difference("Juan")).not.toHaveClass("text-owe");
    expect(difference("Ana")).not.toHaveClass("text-owe-ink");
    expect(
      screen.getByRole("region", { name: "Aportes al fondo" }).querySelector("[data-field='difference']"),
    ).toHaveClass("text-owe-ink");
  });

  it("says nobody has an expected contribution when the period has no plan, and still lists the members", () => {
    show(
      e7Fund({
        plan: null,
        members: [
          { memberId: "m-ana", expected: cop(0), actual: cop(100_000), difference: cop(100_000) },
          { memberId: "m-juan", expected: cop(0), actual: cop(0), difference: cop(0) },
        ],
        totals: { expected: cop(0), actual: cop(100_000), difference: cop(100_000) },
      }),
    );
    expect(screen.getByText("Sin plan, nadie tiene un aporte esperado.")).toBeInTheDocument();
    expect(card("Ana")).toContain("Aportado100.000 COP");
  });

  it("explains what expected means under the cards, and names a member who is gone", () => {
    show(e7Fund(), [HOUSEHOLD_MEMBERS[0]!]);
    expect(
      screen.getByText(
        "Esperado: lo asignado a cada uno en los rubros pagados con el fondo. Cuentan los aportes fechados en el período.",
      ),
    ).toBeInTheDocument();
    expect(card("Miembro anterior")).toContain("Aportado500.000 COP");
  });

  it("leaves out a member with nothing expected and nothing paid in, and keeps one who paid in (#217)", () => {
    const fund = e7Fund();
    fund.members = [
      ...fund.members,
      { memberId: "m-sofi", expected: cop(0), actual: cop(0), difference: cop(0) },
      { memberId: "m-tomas", expected: cop(0), actual: cop(30_000), difference: cop(30_000) },
    ];
    show(fund, [
      ...HOUSEHOLD_MEMBERS,
      spaceMemberDto({ id: "m-sofi", userId: "u-sofi", displayName: "Sofi", role: "VIEWER" }),
      spaceMemberDto({ id: "m-tomas", userId: "u-tomas", displayName: "Tomás", role: "VIEWER" }),
    ]);
    expect(screen.queryByRole("listitem", { name: "Sofi" })).toBeNull();
    expect(card("Tomás")).toContain("Aportado30.000 COP");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  describe("a member's detail (P328, board Por persona · detalle de Ana)", () => {
    /** Ana: 1,680,000 of the 4,000,000 plan; she paid the 1,200,000 rent directly and put 160,000 into the fund. */
    const anaPaysRent = () =>
      e7Fund({
        members: [
          {
            memberId: "m-ana",
            expected: cop(1_680_000),
            actual: cop(1_360_000),
            difference: cop(-320_000),
            paidDirectly: [{ lineId: "l-rent", name: "Arriendo", amount: cop(1_200_000) }],
          },
          { memberId: "m-juan", expected: cop(2_320_000), actual: cop(2_320_000), difference: cop(0) },
        ],
        totals: { expected: cop(4_000_000), actual: cop(3_680_000), difference: cop(-320_000) },
      });

    it("opens Ana's part, what she paid directly, what went to the fund and what she still has to put in", async () => {
      show(anaPaysRent());
      await userEvent.click(screen.getByRole("button", { name: "Ver lo que le toca a Ana" }));
      const sheet = await screen.findByRole("dialog", { name: "Ana · noviembre" });
      const text = normalized(sheet.textContent);
      expect(text).toContain("Le toca1.680.000 COP");
      // P328: the total is what the fund pays (the lines paid with it), never the whole plan.
      expect(text).toContain("42 % de lo que sale del fondo (4.000.000 COP)");
      expect(text).not.toContain("del plan");
      expect(text).toContain("Arriendolo paga directo · ya pagado1.200.000 COP");
      expect(text).toContain("Al fondo de Householdaportó 160.000 COP de 480.000 COP480.000 COP");
      expect(text).toContain("Le faltan320.000 COP");
      expect(await axeViolations(sheet)).toEqual([]);
    });

    it("says in English that the share is of what the fund pays", async () => {
      renderWithIntl(
        <FundTracking
          fund={anaPaysRent()}
          members={HOUSEHOLD_MEMBERS}
          space={householdDto()}
          formats={BUILT_IN_FORMATS}
        />,
        { locale: "en" },
      );
      await userEvent.click(screen.getByRole("button", { name: /Ana/ }));
      const sheet = await screen.findByRole("dialog");
      const text = normalized(sheet.textContent);
      expect(text).toContain("42 % of what the fund pays (4.000.000 COP)");
      expect(text).not.toContain("plan");
    });

    it("says a member with nothing left is up to date, with no line paid directly", async () => {
      show(anaPaysRent());
      await userEvent.click(screen.getByRole("button", { name: "Ver lo que le toca a Juan" }));
      const sheet = await screen.findByRole("dialog", { name: "Juan · noviembre" });
      expect(within(sheet).getAllByRole("listitem")).toHaveLength(2);
      expect(normalized(sheet.textContent)).toContain(
        "Al fondo de Householdaportó 2.320.000 COP de 2.320.000 COP",
      );
      expect(within(sheet).getByText("Al día")).toBeVisible();
    });
  });
});

describe("the fund per currency (ruling P342 S7)", () => {
  const usd = (major: number) => ({ amount: String(major * 100), currency: "USD" });
  /** Juan was to put 100 USD in the fund besides his pesos, and put in 45 USD. */
  const twoCurrencies = () => {
    const fund = e7Fund();
    return e7Fund({
      currencies: [
        { members: fund.members, totals: fund.totals },
        {
          members: [
            { memberId: "m-ana", expected: usd(0), actual: usd(0), difference: usd(0) },
            { memberId: "m-juan", expected: usd(100), actual: usd(45), difference: usd(-55) },
          ],
          totals: { expected: usd(100), actual: usd(45), difference: usd(-55) },
        },
      ],
    });
  };

  it("shows every total and every member's figures in each currency, never converted", async () => {
    const { container } = show(twoCurrencies());
    const summary = normalized(screen.getByRole("region", { name: "Aportes al fondo" }).textContent);
    expect(summary).toContain("Esperado1.200.000 COP100 USD");
    expect(summary).toContain("Aportado980.000 COP45 USD");
    const juan = card("Juan");
    expect(juan).toContain("Esperado720.000 COP100 USD");
    expect(juan).toContain("Aportado500.000 COP45 USD");
    expect(juan).toContain("Diferencia−⁠220.000 COP−⁠55 USD");
    expect(juan).toContain("Le faltan 220.000 COP para el fondo");
    expect(juan).toContain("Le faltan 55 USD para el fondo");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("leaves a member with nothing in another currency as before", () => {
    show(twoCurrencies());
    expect(card("Ana")).toContain("Al día con el fondo");
    expect(card("Ana")).not.toContain("USD");
  });

  it("is up to date only when every currency is", () => {
    const fund = twoCurrencies();
    fund.members[1] = { ...fund.members[1]!, actual: cop(720_000), difference: cop(0) };
    show(fund);
    expect(card("Juan")).not.toContain("Al día con el fondo");
    expect(card("Juan")).toContain("Le faltan 55 USD para el fondo");
  });
});
