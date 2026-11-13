import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { cop, guestDto, householdSpace, memberDto, normalized } from "../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { BalancesScreen } from "./balances-screen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));

const ANA = memberDto();
const JUAN = memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" });
const LUIS = memberDto({ id: "m-luis", userId: "u-luis", displayName: "Luis", role: "MEMBER" });
/** An accessible name whose spaces match the formatters' non-breaking ones. */
const named = (text: string) => new RegExp(`^${text.replace(/[.()$+]/g, "\\$&").replace(/ /g, "\\s")}$`);
/** The hero's lines, top to bottom: its caption, the figure and the direction in words (P324). */
const heroText = (name = "Tu saldo en Household") =>
  [...screen.getByRole("region", { name }).children].map((line) => normalized(line.textContent));
const net = (memberId: string, pesos: number) => ({ memberId, net: cop(pesos) });
const view = (props: Partial<Parameters<typeof BalancesScreen>[0]> = {}, locale: "es" | "en" = "es") =>
  renderWithIntl(
    <BalancesScreen
      space={householdSpace({ role: "MEMBER" })}
      members={[ANA, JUAN]}
      meUserId="u-juan"
      balances={[net("m-ana", 150_000), net("m-juan", -150_000)]}
      suggestions={[{ payerMemberId: "m-juan", receivingMemberId: "m-ana", amount: cop(150_000) }]}
      formats={BUILT_IN_FORMATS}
      {...(props as object)}
    />,
    { locale },
  );

describe("balances screen (HU-E9-07, ruling P173)", () => {
  it("shows Juan that he owes Ana 150,000 COP", async () => {
    const { container } = view();
    expect(screen.getByRole("heading", { level: 1, name: "Saldos" })).toBeInTheDocument();
    expect(heroText()).toEqual(["Tu saldo en Household", "$ 150.000", "te toca poner"]);
    const suggestions = screen.getByRole("region", { name: "Para quedar al día" });
    expect(normalized(suggestions.textContent)).toContain("Juan le paga $ 150.000 a Ana");
    const members = screen.getByRole("region", { name: "Por persona" });
    expect(
      within(members).getByRole("link", { name: named("Ana: le toca recibir $ 150.000. Ver historial") }),
    ).toHaveAttribute("href", "/spaces/sp-household/members/m-ana/history");
    expect(
      within(members).getByRole("link", { name: named("Juan (tú): le toca poner $ 150.000. Ver historial") }),
    ).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("says the personal space is al día, with no one to settle with and no history to open (P302, P159)", async () => {
    const { container } = view({
      space: householdSpace({ id: "sp-personal", name: "Personal", kind: "PERSONAL", role: "OWNER" }),
      members: [ANA],
      meUserId: "u-ana",
      balances: [net("m-ana", 0)],
      suggestions: [],
    });
    expect(screen.getByRole("heading", { level: 1, name: "Saldos" })).toBeInTheDocument();
    expect(heroText("Tu saldo en Personal")).toEqual(["Tu saldo en Personal", "$ 0", "estás al día"]);
    expect(screen.getByText("Personal es solo tuyo: aquí no hay nada que saldar.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Para quedar al día" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Por persona" })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("colors who owes and who is owed, never by the colour alone", () => {
    view();
    // P272 (board 01): the hero's figure is ink whatever the direction; its words say who puts and who receives.
    expect(screen.getByTestId("balances-hero-amount")).toHaveClass("text-ink");
    const members = screen.getByRole("region", { name: "Por persona" });
    expect(within(members).getByText(named("−$ 150.000"))).toHaveClass("text-owe");
    expect(within(members).getByText(named("+$ 150.000"))).toHaveClass("text-accent");
  });

  it("states the viewer's figure once, in the hero, with its direction in words under it (P324)", () => {
    view({
      members: [ANA, JUAN],
      meUserId: "u-ana",
      balances: [net("m-ana", 947_000), net("m-juan", -947_000)],
      suggestions: [{ payerMemberId: "m-juan", receivingMemberId: "m-ana", amount: cop(947_000) }],
    });
    const hero = screen.getByRole("region", { name: "Tu saldo en Household" });
    expect(heroText()).toEqual(["Tu saldo en Household", "$ 947.000", "te toca recibir"]);
    expect(within(hero).getAllByText(/947\.000/)).toHaveLength(1);
    expect(screen.getByTestId("balances-hero-amount")).toHaveClass("font-semibold");
    // The hero is no card and no sentence: the figure stands alone.
    expect(hero).not.toHaveClass("rounded-2xl");
    expect(normalized(hero.textContent)).not.toMatch(/Te toca recibir \$/);
  });

  it("draws each suggestion as an action line between hairlines, not as a card (P324)", () => {
    view({
      members: [ANA, JUAN, LUIS],
      meUserId: "u-ana",
      balances: [net("m-ana", 150_000), net("m-juan", -100_000), net("m-luis", -50_000)],
      suggestions: [
        { payerMemberId: "m-juan", receivingMemberId: "m-ana", amount: cop(100_000) },
        { payerMemberId: "m-luis", receivingMemberId: "m-ana", amount: cop(50_000) },
      ],
    });
    const region = screen.getByRole("region", { name: "Para quedar al día" });
    const list = within(region).getByRole("list");
    expect(list).toHaveClass("divide-y", "divide-line", "border-y");
    const lines = within(list).getAllByRole("listitem");
    expect(lines.map((line) => normalized(line.textContent))).toEqual([
      "Juan le paga $ 100.000 a AnaSaldar",
      "Luis le paga $ 50.000 a AnaSaldar",
    ]);
    for (const line of lines) {
      expect(line).not.toHaveClass("rounded-2xl");
      expect(line).not.toHaveClass("border");
      expect(line).not.toHaveClass("bg-surface");
      expect(line.querySelector("img, [data-avatar]")).toBeNull();
      const action = within(line).getByRole("button", { name: /^Saldar:/ });
      expect(action).toHaveClass("text-accent");
      expect(action).not.toHaveClass("bg-accent");
    }
    // The note is said once, under the lines.
    expect(
      within(region).getAllByText("Cada quien le paga a quien pagó por él.", { exact: false }),
    ).toHaveLength(1);
  });

  it("gives each member row a word and a signed amount, so the colour never carries the direction alone (P324)", () => {
    view({
      members: [ANA, JUAN, guestDto()],
      meUserId: "u-ana",
      balances: [net("m-ana", 947_000), net("m-juan", -947_000), net("m-pedro", 0)],
      suggestions: [{ payerMemberId: "m-juan", receivingMemberId: "m-ana", amount: cop(947_000) }],
    });
    const members = screen.getByRole("region", { name: "Por persona" });
    expect(within(members).getByRole("list")).not.toHaveClass("rounded-2xl");
    expect(
      within(members)
        .getAllByRole("link")
        .map((link) => normalized(link.textContent)),
    ).toEqual([
      "Ana (tú)te toca recibir+$ 947.000",
      "Juanle toca poner−$ 947.000",
      "Pedro (invitado)al día$ 0",
    ]);
    // An amount never breaks across lines.
    expect(within(members).getByText(named("−$ 947.000"))).toHaveClass("whitespace-nowrap");
    expect(within(members).getByText(named("$ 0"))).toHaveClass("text-muted");
  });

  it("reads the same sentences in English", () => {
    view({}, "en");
    expect(heroText("Your balance in Household")).toEqual([
      "Your balance in Household",
      "$ 150.000",
      "you owe",
    ]);
    expect(normalized(screen.getByRole("region", { name: "To settle up" }).textContent)).toContain(
      "Juan owes Ana $ 150.000",
    );
    const members = within(screen.getByRole("region", { name: "Per person" }));
    expect(members.getAllByRole("link").map((link) => normalized(link.textContent))).toEqual([
      "Anais owed+$ 150.000",
      "Juan (you)you owe−$ 150.000",
    ]);
  });

  it("lists one suggestion per payment of the trip, and the guest with its suffix", () => {
    view({
      members: [ANA, JUAN, LUIS, guestDto()],
      meUserId: "u-ana",
      balances: [net("m-ana", 150_000), net("m-juan", -100_000), net("m-luis", -50_000), net("m-pedro", 0)],
      suggestions: [
        { payerMemberId: "m-juan", receivingMemberId: "m-ana", amount: cop(100_000) },
        { payerMemberId: "m-luis", receivingMemberId: "m-ana", amount: cop(50_000) },
      ],
    });
    expect(heroText()).toEqual(["Tu saldo en Household", "$ 150.000", "te toca recibir"]);
    const suggestions = within(screen.getByRole("region", { name: "Para quedar al día" })).getAllByRole(
      "listitem",
    );
    expect(suggestions).toHaveLength(2);
    expect(normalized(suggestions[0]!.textContent)).toContain("Juan le paga $ 100.000 a Ana");
    expect(normalized(suggestions[1]!.textContent)).toContain("Luis le paga $ 50.000 a Ana");
    expect(
      screen.getByRole("link", { name: named("Pedro (invitado): al día. Ver historial") }),
    ).toBeInTheDocument();
  });

  it("leaves out a member no movement touched at zero, and keeps one with history at zero (#217, P263)", () => {
    const SOFI = memberDto({ id: "m-sofi", userId: "u-sofi", displayName: "Sofi", role: "VIEWER" });
    view({
      members: [ANA, JUAN, SOFI, guestDto()],
      balances: [
        { ...net("m-ana", 0), hasMovements: true },
        { ...net("m-juan", 0), hasMovements: true },
        { ...net("m-sofi", 0), hasMovements: false },
        { ...net("m-pedro", 0), hasMovements: false },
      ],
      suggestions: [],
    });
    const members = within(screen.getByRole("region", { name: "Por persona" }));
    expect(members.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/spaces/sp-household/members/m-ana/history",
      "/spaces/sp-household/members/m-juan/history",
    ]);
    expect(members.getByRole("link", { name: named("Ana: al día. Ver historial") })).toBeInTheDocument();
  });

  it("keeps the viewer's own row and its history before they take part (#217, P263)", () => {
    view({
      meUserId: "u-ana",
      members: [ANA, JUAN],
      balances: [
        { ...net("m-ana", 0), hasMovements: false },
        { ...net("m-juan", 0), hasMovements: false },
      ],
      suggestions: [],
    });
    const members = within(screen.getByRole("region", { name: "Por persona" }));
    expect(members.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/spaces/sp-household/members/m-ana/history",
    ]);
  });

  it("keeps everyone when the balances do not say who moved, as an older API answers", () => {
    view({
      members: [ANA, JUAN, guestDto()],
      balances: [net("m-ana", 0), net("m-juan", 0)],
      suggestions: [],
    });
    const members = within(screen.getByRole("region", { name: "Por persona" }));
    expect(members.getAllByRole("link")).toHaveLength(3);
  });

  it("says when nobody owes anybody", () => {
    view({ balances: [net("m-ana", 0), net("m-juan", 0)], suggestions: [] });
    expect(heroText()).toEqual(["Tu saldo en Household", "$ 0", "estás al día"]);
    expect(screen.getByText("Todos están al día en Household.")).toBeInTheDocument();
    const suggestions = screen.getByRole("region", { name: "Para quedar al día" });
    expect(within(suggestions).queryAllByRole("listitem")).toHaveLength(0);
    expect(within(suggestions).queryByText(/prellena el formulario/)).toBeNull();
  });

  it("lets a very long unbroken space name wrap instead of widening the screen", () => {
    const name = "W".repeat(80);
    view({ space: householdSpace({ name, role: "MEMBER" }) });
    expect(screen.getByText(`Tu saldo en ${name}`)).toHaveClass("[overflow-wrap:anywhere]");
  });

  it("draws its board: an ink figure, a text Saldar otro monto by Por persona, no Miembros button (P272, P324)", () => {
    view({
      members: [ANA, JUAN, LUIS],
      meUserId: "u-ana",
      balances: [net("m-ana", 150_000), net("m-juan", -100_000), net("m-luis", -50_000)],
      suggestions: [
        { payerMemberId: "m-juan", receivingMemberId: "m-ana", amount: cop(100_000) },
        { payerMemberId: "m-luis", receivingMemberId: "m-ana", amount: cop(50_000) },
      ],
    });
    const figure = screen.getByTestId("balances-hero-amount");
    expect(figure).toHaveClass("text-ink");
    expect(figure).not.toHaveClass("text-accent");
    const other = screen.getByRole("button", { name: "Saldar otro monto" });
    expect(other).toHaveClass("text-accent");
    expect(other).not.toHaveClass("border");
    // The members stay one tap away in the profile sheet and on Inicio; the board's Saldos has no Miembros button.
    expect(screen.queryByRole("link", { name: "Miembros" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Por persona" })).toBeInTheDocument();
  });

  it("marks each member row with a chevron, as each one opens that member's history", () => {
    view();
    const links = within(screen.getByRole("region", { name: "Por persona" })).getAllByRole("link");
    expect(links).toHaveLength(2);
    for (const link of links) expect(link.querySelector("svg")).not.toBeNull();
  });

  it("is a bottom-navigation destination, so it has no back link", () => {
    view();
    expect(screen.queryByRole("link", { name: "Volver" })).toBeNull();
  });
});
