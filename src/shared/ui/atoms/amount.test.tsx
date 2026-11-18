import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BUILT_IN_FORMATS, formatMoney } from "../format/formatters";
import { Amount, AmountText } from "./amount";
import { HeroAmount } from "./hero-amount";

const money = (pesos: number) =>
  formatMoney({ amount: String(pesos * 100), currency: "COP" }, BUILT_IN_FORMATS);

/** Ruling P335: an amount never breaks across lines and never overflows; the layout around it adapts. */
describe("Amount (P335)", () => {
  it("keeps an amount on one line, in tabular figures, and marks it for the layout checks", () => {
    render(<Amount className="font-semibold">{"−\u20601.234.567 COP"}</Amount>);
    const amount = screen.getByText("−\u20601.234.567 COP");
    expect(amount.tagName).toBe("SPAN");
    expect(amount).toHaveClass("whitespace-nowrap", "tabular-nums", "font-semibold");
    expect(amount).toHaveAttribute("data-amount");
    expect(amount.className).not.toContain("overflow-wrap");
  });

  it("renders as the element its context needs", () => {
    render(
      <dl>
        <dt>Total</dt>
        <Amount as="dd">{"5.000 COP"}</Amount>
      </dl>,
    );
    expect(screen.getByText("5.000 COP").tagName).toBe("DD");
  });

  it("keeps each amount of a sentence whole, sign and all, while the words around it wrap", () => {
    const owed = money(100_000);
    const gift = money(-5_000);
    const percent = "36,75 %";
    const text = `Juan le debe ${owed} a Ana, ${gift} a Luis y el ${percent}.`;
    const { container } = render(
      <p className="[overflow-wrap:anywhere]">
        <AmountText text={text} />
      </p>,
    );
    const amounts = [...container.querySelectorAll("[data-amount]")];
    // A percentage and the sentence's own comma and period are not amounts.
    expect(amounts.map((el) => el.textContent)).toEqual([owed, gift]);
    for (const el of amounts) expect(el).toHaveClass("whitespace-nowrap");
    expect(container.textContent).toBe(text);
  });

  it("finds an amount in every number format, and one of many digits", () => {
    for (const numberFormat of ["DOT_COMMA", "COMMA_DOT", "SPACE_COMMA"] as const) {
      const amount = formatMoney({ amount: "-123456789012345", currency: "USD" }, { numberFormat });
      const { container, unmount } = render(<AmountText text={`Saldo: ${amount}.`} />);
      expect(container.querySelector("[data-amount]")?.textContent).toBe(amount);
      unmount();
    }
  });

  it("is one inline element, so a flex parent lays the sentence out as text, not as a column per fragment", () => {
    // Staging check, 2026-11-15: Inicio's line sits in a `flex` link, which made each fragment its own column.
    const { container } = render(
      <a href="/x" className="flex items-center">
        <AmountText text={`Solo tú ${money(75_000)} · con otros ${money(1_050_000)}`} />
      </a>,
    );
    const link = container.querySelector("a")!;
    expect(link.childNodes).toHaveLength(1);
    expect((link.firstChild as HTMLElement).tagName).toBe("SPAN");
    expect(link.textContent).toBe(`Solo tú ${money(75_000)} · con otros ${money(1_050_000)}`);
  });

  it("leaves a sentence without amounts as it is", () => {
    const { container } = render(<AmountText text="Están a paz" />);
    expect(container.innerHTML).toBe("<span>Están a paz</span>");
  });
});

describe("HeroAmount (P335)", () => {
  it("scales with the width of its own container, between a minimum and its design size, on one line", () => {
    render(<HeroAmount amount={"1.234.567 COP"} size="2.25rem" className="font-semibold" />);
    const figure = screen.getByText("1.234.567 COP");
    expect(figure).toHaveClass("whitespace-nowrap", "tabular-nums", "font-semibold");
    expect(figure).toHaveAttribute("data-amount");
    // A container query: the wrapper is the container, and the size is in container units, never in vw.
    expect(figure.parentElement).toHaveClass("@container");
    expect(figure.className).toContain("cqi");
    expect(figure.className).toContain("clamp(");
    expect(figure.className).not.toContain("vw");
    expect(figure.style.getPropertyValue("--amount-size")).toBe("2.25rem");
  });

  it("divides the width by the amount's own length, so a longer amount gets a smaller size and never overflows", () => {
    render(
      <>
        <HeroAmount amount={"1.000 COP"} size="2.25rem" />
        <HeroAmount amount={"−\u20609.999.999.999.999 COP"} size="2.25rem" />
      </>,
    );
    const short = Number(screen.getByText("1.000 COP").style.getPropertyValue("--amount-ems"));
    const long = Number(
      screen.getByText("−\u20609.999.999.999.999 COP").style.getPropertyValue("--amount-ems"),
    );
    expect(long).toBeGreaterThan(short);
    // 22 characters against 9: the word joiner after the minus takes no room, so it is not counted (P342).
    expect(long / short).toBeCloseTo(22 / 9, 1);
  });

  it("can take an ancestor as its container, minus the room around it", () => {
    render(
      <div className="@container">
        <HeroAmount amount={"22.000 COP"} size="22px" contained={false} inset="30px" />
      </div>,
    );
    const figure = screen.getByText("22.000 COP");
    // No wrapper of its own: its parent is the ancestor that is the container.
    expect(figure.parentElement?.tagName).toBe("DIV");
    expect(figure.parentElement).toHaveClass("@container");
    expect(figure.style.getPropertyValue("--amount-inset")).toBe("30px");
  });
});
