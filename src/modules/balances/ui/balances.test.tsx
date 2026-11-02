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
const named = (text: string) => new RegExp(`^${text.replace(/[.()$]/g, "\\$&").replace(/ /g, "\\s")}$`);
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
    expect(normalized(screen.getByRole("region", { name: "Tu saldo en Household" }).textContent)).toContain(
      "Te toca poner $ 150.000",
    );
    const suggestions = screen.getByRole("region", { name: "Para quedar al día" });
    expect(normalized(suggestions.textContent)).toContain("Juan le paga $ 150.000 a Ana");
    const members = screen.getByRole("region", { name: "Cada miembro" });
    expect(
      within(members).getByRole("link", { name: named("Ana: le toca recibir $ 150.000. Ver historial") }),
    ).toHaveAttribute("href", "/spaces/sp-household/members/m-ana/history");
    expect(
      within(members).getByRole("link", { name: named("Juan (tú): le toca poner $ 150.000. Ver historial") }),
    ).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("colors who owes and who is owed, never by the sign alone", () => {
    view();
    // P272 (board 01): the headline is ink whatever the direction; its words say who puts and who receives.
    expect(screen.getByText(/^Te toca poner/)).toHaveClass("text-ink");
    const members = screen.getByRole("region", { name: "Cada miembro" });
    expect(within(members).getByText(/^le toca poner\s/)).toHaveClass("text-owe");
    expect(within(members).getByText(/^le toca recibir\s/)).toHaveClass("text-accent");
  });

  it("reads the same sentences in English", () => {
    view({}, "en");
    expect(
      normalized(screen.getByRole("region", { name: "Your balance in Household" }).textContent),
    ).toContain("You owe $ 150.000");
    expect(normalized(screen.getByRole("region", { name: "To settle up" }).textContent)).toContain(
      "Juan owes Ana $ 150.000",
    );
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
    expect(normalized(screen.getByRole("region", { name: "Tu saldo en Household" }).textContent)).toContain(
      "Te toca recibir $ 150.000",
    );
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
    const members = within(screen.getByRole("region", { name: "Cada miembro" }));
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
    const members = within(screen.getByRole("region", { name: "Cada miembro" }));
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
    const members = within(screen.getByRole("region", { name: "Cada miembro" }));
    expect(members.getAllByRole("link")).toHaveLength(3);
  });

  it("says when nobody owes anybody", () => {
    view({ balances: [net("m-ana", 0), net("m-juan", 0)], suggestions: [] });
    expect(normalized(screen.getByRole("region", { name: "Tu saldo en Household" }).textContent)).toContain(
      "Estás al día",
    );
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

  it("draws its board: one card per suggestion with a filled Saldar, a text Saldar otro monto, no Miembros button (P272)", () => {
    view({
      members: [ANA, JUAN, LUIS],
      meUserId: "u-ana",
      balances: [net("m-ana", 150_000), net("m-juan", -100_000), net("m-luis", -50_000)],
      suggestions: [
        { payerMemberId: "m-juan", receivingMemberId: "m-ana", amount: cop(100_000) },
        { payerMemberId: "m-luis", receivingMemberId: "m-ana", amount: cop(50_000) },
      ],
    });
    const headline = screen.getByText(/^Te toca recibir/);
    expect(headline).toHaveClass("text-ink");
    expect(headline).not.toHaveClass("text-accent");
    const cards = within(screen.getByRole("region", { name: "Para quedar al día" })).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card).toHaveClass("rounded-2xl", "border", "bg-surface");
      expect(within(card).getByRole("button", { name: /^Saldar:/ })).toHaveClass(
        "bg-accent",
        "text-on-accent",
      );
    }
    const other = screen.getByRole("button", { name: "Saldar otro monto" });
    expect(other).toHaveClass("text-accent");
    expect(other).not.toHaveClass("border");
    // The members stay one tap away in the profile sheet and on Inicio; the board's Saldos has no Miembros button.
    expect(screen.queryByRole("link", { name: "Miembros" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Cada miembro" })).toBeInTheDocument();
  });

  it("marks each member row with a chevron, as each one opens that member's history", () => {
    view();
    const links = within(screen.getByRole("region", { name: "Cada miembro" })).getAllByRole("link");
    expect(links).toHaveLength(2);
    for (const link of links) expect(link.querySelector("svg")).not.toBeNull();
  });

  it("is a bottom-navigation destination, so it has no back link", () => {
    view();
    expect(screen.queryByRole("link", { name: "Volver" })).toBeNull();
  });
});
