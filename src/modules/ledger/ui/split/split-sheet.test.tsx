import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { accountDto, guestDto, memberDto, normalized } from "../../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { SplitSheet } from "./split-sheet";
import type { SplitDraft } from "./split-request";
import type { DefaultSplitState } from "./use-default-split";

const MEMBERS = [
  memberDto(),
  memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" }),
  guestDto(),
];
const BANK = accountDto({ id: "a-bank", name: "Bancolombia" });
const FUND = accountDto({
  id: "a-fund",
  name: "Fondo Hogar",
  type: "SHARED_FUND",
  ownerUserId: null,
  icon: "users",
});
const EQUAL_DEFAULT: DefaultSplitState = {
  status: "ready",
  key: "k",
  method: "EQUAL",
  availableMethods: ["EQUAL", "PERCENT", "EXACT", "SHARES"],
  shares: null,
};
const start: SplitDraft = {
  payer: { kind: "ME", memberId: "m-ana", accountId: "a-bank" },
  method: "EQUAL",
  selected: ["m-ana", "m-juan"],
  values: {},
  chosen: false,
};

function Harness({
  amount,
  defaultSplit = EQUAL_DEFAULT,
  initial = start,
  seen,
}: {
  amount: string | null;
  defaultSplit?: DefaultSplitState;
  initial?: SplitDraft;
  seen?: (draft: SplitDraft) => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <SplitSheet
      open
      onOpenChange={() => undefined}
      title="Mercado · $ 300.000 · Household"
      members={MEMBERS}
      meUserId="u-ana"
      myAccounts={[BANK]}
      funds={[FUND]}
      draft={draft}
      onChange={(next) => {
        seen?.(next);
        setDraft(next);
      }}
      amount={amount}
      currency="COP"
      formats={BUILT_IN_FORMATS}
      defaultSplit={defaultSplit}
    />
  );
}
const sheet = () => screen.getByRole("dialog", { name: "Quién pagó y para quién" });
const shareOf = (name: string) => normalized(within(sheet()).getByRole("listitem", { name }).textContent);
const valueOf = (name: string) => within(sheet()).getByLabelText(`Valor de ${name}`);
const done = () => within(sheet()).getByRole("button", { name: "Listo" });
const status = () => within(sheet()).getByRole("status");

describe("split sheet (HU-E9-06)", () => {
  it("splits 300,000 COP equally between Ana and Juan and says the sum matches", async () => {
    renderWithIntl(<Harness amount="30000000" />);
    expect(shareOf("Ana (tú)")).toContain("$ 150.000");
    expect(shareOf("Juan")).toContain("$ 150.000");
    expect(shareOf("Pedro (invitado)")).toContain("—");
    expect(status()).toHaveTextContent("Suma $ 300.000: cuadra con el gasto");
    expect(done()).toBeEnabled();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it.each([
    ["30000000", "Porcentaje", ["40", "60"], ["$ 120.000", "$ 180.000"]],
    ["25000000", "Montos", ["100.000", "150.000"], ["$ 100.000", "$ 150.000"]],
    ["9000000", "Partes", ["2", "1"], ["$ 60.000", "$ 30.000"]],
  ] as const)("previews %s split by %s", async (amount, method, [ana, juan], [anaShare, juanShare]) => {
    renderWithIntl(<Harness amount={amount} />);
    await userEvent.click(within(sheet()).getByRole("radio", { name: method }));
    await userEvent.type(valueOf("Ana (tú)"), ana);
    await userEvent.type(valueOf("Juan"), juan);
    expect(shareOf("Ana (tú)")).toContain(anaShare);
    expect(shareOf("Juan")).toContain(juanShare);
  });

  it("says that 10 % remains unassigned and keeps Listo disabled", async () => {
    renderWithIntl(<Harness amount="30000000" />);
    await userEvent.click(within(sheet()).getByRole("radio", { name: "Porcentaje" }));
    await userEvent.type(valueOf("Ana (tú)"), "40");
    await userEvent.type(valueOf("Juan"), "50");
    expect(status()).toHaveTextContent("Falta asignar 10 %");
    expect(done()).toBeDisabled();
  });

  it("says how much money is unassigned for exact amounts", async () => {
    renderWithIntl(<Harness amount="30000000" />);
    await userEvent.click(within(sheet()).getByRole("radio", { name: "Montos" }));
    await userEvent.type(valueOf("Ana (tú)"), "100.000");
    await userEvent.type(valueOf("Juan"), "100.000");
    expect(status()).toHaveTextContent("Falta asignar $ 100.000");
    expect(done()).toBeDisabled();
  });

  it("says what is too much, unreadable, or missing", async () => {
    renderWithIntl(<Harness amount="30000000" />);
    await userEvent.click(within(sheet()).getByRole("radio", { name: "Porcentaje" }));
    await userEvent.type(valueOf("Ana (tú)"), "70");
    await userEvent.type(valueOf("Juan"), "50");
    expect(status()).toHaveTextContent("Sobra 20 %: deben sumar 100 %");
    await userEvent.clear(valueOf("Juan"));
    expect(status()).toHaveTextContent("Revisa el valor de Juan");
    await userEvent.click(within(sheet()).getByRole("checkbox", { name: "Juan" }));
    await userEvent.click(within(sheet()).getByRole("checkbox", { name: "Ana (tú)" }));
    expect(status()).toHaveTextContent("Elige al menos una persona");
    expect(done()).toBeDisabled();
  });

  it("says an amount too small to split between three people in whole pesos", async () => {
    renderWithIntl(<Harness amount="200" />);
    await userEvent.click(within(sheet()).getByRole("checkbox", { name: "Pedro (invitado)" }));
    expect(status()).toHaveTextContent("El monto es muy pequeño para dividirlo así");
    expect(done()).toBeDisabled();
  });

  it("follows the plan with its shares and locked participants, and switches to equal parts", async () => {
    const planned: DefaultSplitState = {
      status: "ready",
      key: "k",
      method: "BY_ALLOCATION",
      availableMethods: ["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"],
      shares: [
        { memberId: "m-ana", amount: "80000000" },
        { memberId: "m-juan", amount: "120000000" },
      ],
    };
    renderWithIntl(
      <Harness amount="200000000" defaultSplit={planned} initial={{ ...start, method: "BY_ALLOCATION" }} />,
    );
    expect(within(sheet()).getByRole("radio", { name: "Según el plan" })).toBeChecked();
    expect(within(sheet()).getByRole("checkbox", { name: "Juan" })).toBeDisabled();
    expect(shareOf("Ana (tú)")).toContain("$ 800.000");
    expect(shareOf("Juan")).toContain("$ 1.200.000");
    await userEvent.click(within(sheet()).getByRole("radio", { name: "Iguales" }));
    expect(shareOf("Ana (tú)")).toContain("$ 1.000.000");
    expect(shareOf("Juan")).toContain("$ 1.000.000");
  });

  it("lists the plan's participants even when the draft remembers others", () => {
    const planned: DefaultSplitState = {
      status: "ready",
      key: "k",
      method: "BY_ALLOCATION",
      availableMethods: ["BY_ALLOCATION", "EQUAL"],
      shares: [
        { memberId: "m-ana", amount: "10000000" },
        { memberId: "m-pedro", amount: "10000000" },
      ],
    };
    renderWithIntl(
      <Harness
        amount="20000000"
        defaultSplit={planned}
        initial={{ ...start, method: "BY_ALLOCATION", selected: ["m-juan"] }}
      />,
    );
    expect(within(sheet()).getByRole("checkbox", { name: "Ana (tú)" })).toBeChecked();
    expect(within(sheet()).getByRole("checkbox", { name: "Juan" })).not.toBeChecked();
    expect(within(sheet()).getByRole("checkbox", { name: "Pedro (invitado)" })).toBeChecked();
  });

  it("does not offer the plan's split when the default leaves it out", () => {
    renderWithIntl(<Harness amount="5000000" />);
    expect(within(sheet()).queryByRole("radio", { name: "Según el plan" })).not.toBeInTheDocument();
  });

  it("offers every method but the plan's before the default split arrives", () => {
    renderWithIntl(<Harness amount="30000000" defaultSplit={{ status: "none" }} />);
    expect(
      within(within(sheet()).getByRole("radiogroup", { name: "Cómo se divide" }))
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["Iguales", "Porcentaje", "Montos", "Partes"]);
  });

  it("selecting the plan's method selects exactly the members with a share in the plan", async () => {
    const planned: DefaultSplitState = {
      status: "ready",
      key: "k",
      method: "BY_ALLOCATION",
      availableMethods: ["BY_ALLOCATION", "EQUAL"],
      shares: [
        { memberId: "m-ana", amount: "0" },
        { memberId: "m-juan", amount: "20000000" },
      ],
    };
    const drafts: SplitDraft[] = [];
    renderWithIntl(<Harness amount="20000000" defaultSplit={planned} seen={(d) => drafts.push(d)} />);
    await userEvent.click(within(sheet()).getByRole("radio", { name: "Según el plan" }));
    expect(drafts.at(-1)).toMatchObject({ method: "BY_ALLOCATION", selected: ["m-juan"], chosen: true });
  });

  it("waits for the plan's shares without calling the split invalid", () => {
    renderWithIntl(
      <Harness
        amount="30000000"
        defaultSplit={{ status: "none" }}
        initial={{ ...start, method: "BY_ALLOCATION" }}
      />,
    );
    expect(status()).toBeEmptyDOMElement();
    expect(done()).toBeDisabled();
  });

  it("shows no status or shares while the expense has no amount", () => {
    renderWithIntl(<Harness amount={null} />);
    expect(status()).toBeEmptyDOMElement();
    expect(shareOf("Ana (tú)")).toContain("—");
    expect(done()).toBeDisabled();
  });

  it("offers the recorder, the guest and the fund as payers, and explains the guest and the fund", async () => {
    renderWithIntl(<Harness amount="30000000" />);
    const payers = within(sheet()).getByRole("radiogroup", { name: "Pagó" });
    expect(
      within(payers)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["Ana (tú)", "Pedro (invitado)", "Fondo Hogar"]);
    expect(within(sheet()).getByRole("radiogroup", { name: "Desde" })).toBeInTheDocument();
    await userEvent.click(within(payers).getByRole("radio", { name: "Pedro (invitado)" }));
    expect(
      within(sheet()).getByText("Pedro es invitado: pagó fuera de la app, así que no hay cuenta que elegir."),
    ).toBeInTheDocument();
    expect(within(sheet()).queryByRole("radiogroup", { name: "Desde" })).not.toBeInTheDocument();
    await userEvent.click(within(payers).getByRole("radio", { name: "Fondo Hogar" }));
    expect(
      within(sheet()).getByText("Sale de la cuenta Fondo Hogar. Nadie queda debiendo por este gasto."),
    ).toBeInTheDocument();
  });

  it("goes back to the recorder's first account after another payer, and a payer change is not split work", async () => {
    const drafts: SplitDraft[] = [];
    renderWithIntl(<Harness amount="30000000" seen={(d) => drafts.push(d)} />);
    const payers = within(sheet()).getByRole("radiogroup", { name: "Pagó" });
    await userEvent.click(within(payers).getByRole("radio", { name: "Fondo Hogar" }));
    await userEvent.click(within(payers).getByRole("radio", { name: "Pedro (invitado)" }));
    await userEvent.click(within(payers).getByRole("radio", { name: "Ana (tú)" }));
    expect(drafts.map((d) => d.payer)).toEqual([
      { kind: "FUND", accountId: "a-fund" },
      { kind: "GUEST", memberId: "m-pedro" },
      { kind: "ME", memberId: "m-ana", accountId: "a-bank" },
    ]);
    expect(drafts.every((d) => !d.chosen)).toBe(true);
  });

  it("marks the draft as chosen when a method, a participant or a value changes", async () => {
    const drafts: SplitDraft[] = [];
    renderWithIntl(<Harness amount="30000000" seen={(d) => drafts.push(d)} />);
    await userEvent.click(within(sheet()).getByRole("checkbox", { name: "Pedro (invitado)" }));
    await userEvent.click(within(sheet()).getByRole("radio", { name: "Porcentaje" }));
    await userEvent.type(valueOf("Ana (tú)"), "5");
    expect(drafts).toHaveLength(3);
    expect(drafts.every((d) => d.chosen)).toBe(true);
    expect(drafts.at(-1)).toMatchObject({
      method: "PERCENT",
      selected: ["m-ana", "m-juan", "m-pedro"],
      values: { "m-ana": "5" },
    });
  });

  it("marks a value typed first as the person's choice", async () => {
    const drafts: SplitDraft[] = [];
    renderWithIntl(
      <Harness amount="30000000" initial={{ ...start, method: "PERCENT" }} seen={(d) => drafts.push(d)} />,
    );
    await userEvent.type(valueOf("Ana (tú)"), "4");
    expect(drafts).toEqual([expect.objectContaining({ chosen: true, values: { "m-ana": "4" } })]);
  });

  it("asks a value only of the selected people, and none for equal parts", async () => {
    renderWithIntl(<Harness amount="30000000" />);
    expect(within(sheet()).queryByLabelText(/^Valor de/)).not.toBeInTheDocument();
    await userEvent.click(within(sheet()).getByRole("radio", { name: "Montos" }));
    expect(valueOf("Ana (tú)")).toBeInTheDocument();
    expect(valueOf("Juan")).toBeInTheDocument();
    expect(within(sheet()).queryByLabelText("Valor de Pedro (invitado)")).not.toBeInTheDocument();
  });

  it("closes the sheet with Listo", async () => {
    let open = true;
    renderWithIntl(
      <SplitSheet
        open
        onOpenChange={(next) => (open = next)}
        title="t"
        members={MEMBERS}
        meUserId="u-ana"
        myAccounts={[BANK]}
        funds={[]}
        draft={start}
        onChange={() => undefined}
        amount="30000000"
        currency="COP"
        formats={BUILT_IN_FORMATS}
        defaultSplit={EQUAL_DEFAULT}
      />,
    );
    await userEvent.click(done());
    expect(open).toBe(false);
  });
});
