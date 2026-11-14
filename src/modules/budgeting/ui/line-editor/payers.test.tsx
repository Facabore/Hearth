import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import {
  HOUSEHOLD_MEMBERS,
  householdDto,
  planLineDto,
  referencePlanDto,
  spaceMemberDto,
} from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { PlanLineDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { LineEditor } from "./line-editor";
import { LinePayersEditor } from "./line-payers-editor";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, notFound: vi.fn(), redirect: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

const ADD = "POST /api/v1/spaces/{spaceId}/plans/{planId}/lines";
const PATCH = "PATCH /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}";
const SOFIA = spaceMemberDto({ id: "m-sofia", userId: "u-sofia", displayName: "Sofía", role: "VIEWER" });
const MEMBERS = [...HOUSEHOLD_MEMBERS, SOFIA];
/** Rent: 1,200,000 COP from the fund, 40 % Ana and 60 % Juan by their capacities. */
const rent = (overrides: Partial<PlanLineDto> = {}) =>
  planLineDto({
    id: "l-rent",
    name: "Arriendo",
    plannedAmount: cop(1_200_000),
    funding: "SHARED_FUND",
    capacityShare: "30.00",
    allocation: {
      rule: "PROPORTIONAL",
      members: [
        { memberId: "m-ana", percent: null, amount: null, assigned: cop(480_000) },
        { memberId: "m-juan", percent: null, amount: null, assigned: cop(720_000) },
      ],
      error: null,
    },
    ...overrides,
  });
const saved = () => jsonResponse(referencePlanDto({ version: 8 }));
const show = (line: PlanLineDto | null, api: Api, hasFund: boolean) =>
  renderWithIntl(
    <LineEditor
      space={householdDto()}
      plan={line ? referencePlanDto() : referencePlanDto({ lines: [], planned: cop(0) })}
      line={line}
      savingsAccounts={[]}
      groups={[]}
      members={MEMBERS}
      hasFund={hasFund}
      viewerMemberId="m-ana"
      formats={BUILT_IN_FORMATS}
      api={api}
    />,
  );
const row = () => screen.getByRole("button", { name: /Se paga desde/ });

describe("who pays a line (D26, P328)", () => {
  it("names Ana and Juan every month in a space with a fund: the sheet, the row, the note and the PATCH", async () => {
    const { api, requests } = fakeApi({ [PATCH]: saved });
    const { container } = show(rent(), api, true);
    expect(row()).toHaveTextContent("Sale del fondo comúnSe paga desde");
    await userEvent.click(row());
    const sheet = await screen.findByRole("dialog", { name: "¿Cómo se paga Arriendo?" });
    expect(sheet).toHaveAccessibleDescription("Quién responde por él no cambia: Ana 40 % · Juan 60 %.");
    expect(
      within(sheet)
        .getAllByRole("radio")
        .map((radio) => radio.closest("label")?.textContent),
    ).toEqual([
      "Sale del fondo comúnCada uno aporta su parte al fondo",
      "Lo pagan directoElige quiénes. Lo que paguen cuenta como su aporte",
      "Cada uno pagaQuien registre el gasto lo paga",
      "Va al ahorroSe aparta en una cuenta de ahorro en vez de gastarse",
    ]);
    await userEvent.click(within(sheet).getByRole("radio", { name: "Lo pagan directo" }));
    // A VIEWER never pays a line (P261): one checkbox each for Ana (the viewer) and Juan.
    expect(
      within(sheet)
        .getAllByRole("checkbox")
        .map((box) => box.closest("label")?.textContent),
    ).toEqual(["Ana (tú)", "Juan"]);
    await userEvent.click(within(sheet).getByRole("checkbox", { name: "Ana (tú)" }));
    await userEvent.click(within(sheet).getByRole("checkbox", { name: "Juan" }));
    const until = within(sheet).getByRole("radiogroup", { name: "¿Hasta cuándo?" });
    expect(within(until).getByRole("radio", { name: "Todos los meses" })).toBeChecked();
    expect(within(until).getByRole("radio", { name: "Solo noviembre" })).not.toBeChecked();
    expect(sheet).toHaveTextContent("Ana y Juan también pueden cambiarlo desde el rubro.");
    expect(await axeViolations(sheet)).toEqual([]);
    await userEvent.click(within(sheet).getByRole("button", { name: "Listo" }));
    expect(row()).toHaveTextContent("Lo pagan Ana y JuanSe paga desde · todos los meses");
    expect(row()).toHaveAccessibleDescription(
      "Ana y Juan pagan Arriendo entre los dos. Lo que cada uno pague cuenta como su aporte del mes.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Guardar rubro" }));
    expect(await requests[0]!.json()).toEqual({
      payerMemberIds: ["m-ana", "m-juan"],
      payersScope: "EVERY_PERIOD",
    });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("says what the others put into the fund when one member pays", async () => {
    show(rent({ payerMemberIds: ["m-ana"], payersScope: "EVERY_PERIOD" }), fakeApi({}).api, true);
    expect(row()).toHaveTextContent("Lo paga AnaSe paga desde · todos los meses");
    expect(row()).toHaveAccessibleDescription(
      "Ana paga Arriendo. Lo que pague cuenta como su aporte del mes. Juan pone su parte, $ 720.000, en el fondo.",
    );
  });

  it("asks for someone before 'Lo pagan directo' is done", async () => {
    show(rent(), fakeApi({}).api, true);
    await userEvent.click(row());
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByRole("radio", { name: "Lo pagan directo" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Listo" }));
    expect(within(sheet).getByText("Elige al menos a una persona.")).toBeVisible();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("adds a direct line Juan pays for this period only in a space without a fund", async () => {
    const { api, requests } = fakeApi({ [ADD]: () => jsonResponse(referencePlanDto({ version: 8 }), 201) });
    show(null, api, false);
    await userEvent.type(screen.getByLabelText("Nombre"), "Internet");
    await userEvent.type(screen.getByLabelText("Planeado"), "100.000");
    await userEvent.click(row());
    const sheet = await screen.findByRole("dialog", { name: "¿Cómo se paga Internet?" });
    await userEvent.click(within(sheet).getByRole("radio", { name: "Lo pagan directo" }));
    expect(within(sheet).getByRole("radio", { name: "Lo pagan directo" })).toHaveAccessibleDescription(
      "Elige quiénes. Registrar los propone como quien pagó",
    );
    await userEvent.click(within(sheet).getByRole("checkbox", { name: "Juan" }));
    await userEvent.click(within(sheet).getByRole("radio", { name: "Solo noviembre" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Listo" }));
    expect(row()).toHaveTextContent("Lo paga JuanSe paga desde · solo noviembre");
    expect(row()).toHaveAccessibleDescription(
      "Juan suele pagar Internet. Al registrar el gasto aparece como quien pagó, y las deudas quedan en Saldos.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Agregar rubro" }));
    expect(await requests[0]!.json()).toMatchObject({
      name: "Internet",
      funding: "DIRECT",
      payerMemberIds: ["m-juan"],
      payersScope: "THIS_PERIOD",
    });
  });

  it("clears the payers when the line goes back to the fund", async () => {
    const { api, requests } = fakeApi({ [PATCH]: saved });
    show(rent({ payerMemberIds: ["m-ana"], payersScope: "THIS_PERIOD" }), api, true);
    await userEvent.click(row());
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("radio", { name: "Lo pagan directo" })).toBeChecked();
    expect(within(sheet).getByRole("radio", { name: "Solo noviembre" })).toBeChecked();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Sale del fondo común" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Listo" }));
    expect(row()).toHaveTextContent("Sale del fondo comúnSe paga desde");
    await userEvent.click(screen.getByRole("button", { name: "Guardar rubro" }));
    expect(await requests[0]!.json()).toEqual({ payerMemberIds: [] });
  });

  it("lets Juan, a MEMBER who pays the line, change only its payers and scope (D26)", async () => {
    const { api, requests } = fakeApi({ [PATCH]: saved });
    renderWithIntl(
      <LinePayersEditor
        space={householdDto({ role: "MEMBER" })}
        plan={referencePlanDto()}
        line={rent({ payerMemberIds: ["m-juan"], payersScope: "EVERY_PERIOD" })}
        members={MEMBERS}
        viewerMemberId="m-juan"
        formats={BUILT_IN_FORMATS}
        api={api}
      />,
    );
    await userEvent.click(row());
    const sheet = await screen.findByRole("dialog", { name: "¿Cómo se paga Arriendo?" });
    // Only the payers and their scope: no way to change how the line is funded.
    expect(within(sheet).queryByRole("radio", { name: "Sale del fondo común" })).toBeNull();
    await userEvent.click(within(sheet).getByRole("checkbox", { name: "Ana" }));
    await userEvent.click(within(sheet).getByRole("radio", { name: "Solo noviembre" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Listo" }));
    expect(requests[0]!.headers.get("if-match")).toBe('"7"');
    expect(await requests[0]!.json()).toEqual({
      payerMemberIds: ["m-ana", "m-juan"],
      payersScope: "THIS_PERIOD",
    });
    expect(router.refresh).toHaveBeenCalled();
  });
});
