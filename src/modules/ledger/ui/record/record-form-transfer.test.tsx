import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { accountDto, groupDto, spaceDto, transactionDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import type { Person } from "../direct/counterparts";
import { RecordForm } from "./record-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T04:30:00Z"));
});
afterEach(() => vi.useRealTimers());

const accounts = [
  accountDto({ id: "a-bank", name: "Bancolombia", type: "BANK" }),
  accountDto({ id: "a-nequi", name: "Nequi", type: "BANK" }),
];
/** Juan shares the direct space "Ana & Juan" with Ana; Luis only the household, so their direct space is not made yet. */
const PEOPLE: Person[] = [
  {
    memberId: "m-juan-d",
    name: "Juan",
    isGuest: false,
    directSpace: "Ana & Juan",
    places: [
      {
        spaceId: "sp-ana-juan",
        name: "Ana & Juan",
        kind: "DIRECT",
        currency: "COP",
        theirMemberId: "m-juan-d",
        myMemberId: "m-ana-d",
      },
    ],
  },
  {
    memberId: "m-luis",
    name: "Luis",
    isGuest: false,
    directSpace: null,
    places: [
      { spaceId: null, name: null, kind: "DIRECT", currency: null, theirMemberId: null, myMemberId: null },
      {
        spaceId: "sp-household",
        name: "Household",
        kind: "SHARED",
        currency: "COP",
        theirMemberId: "m-luis",
        myMemberId: "m-ana",
      },
    ],
  },
];
const cop = (pesos: number) => ({ amount: String(pesos * 100), currency: "COP" });
/** In "Ana & Juan", `who` owes the other 100,000 COP (P323's pairs). */
const owing = (who: "ANA" | "JUAN") =>
  jsonResponse({
    spaceId: "sp-ana-juan",
    currency: "COP",
    suggestions: [
      who === "ANA"
        ? { payerMemberId: "m-ana-d", receivingMemberId: "m-juan-d", amount: cop(100_000) }
        : { payerMemberId: "m-juan-d", receivingMemberId: "m-ana-d", amount: cop(100_000) },
    ],
  });
const settled = () => jsonResponse(transactionDto({ id: "t-settled", type: "SETTLEMENT" }), 201);
const form = (api: Api) =>
  renderWithIntl(
    <RecordForm
      space={spaceDto()}
      accounts={accounts}
      groups={[groupDto()]}
      formats={BUILT_IN_FORMATS}
      initialKind="TRANSFER"
      initialNow="2026-11-01T04:30:00.000Z"
      timeZone="America/Bogota"
      people={PEOPLE}
      api={api}
    />,
  );
const mode = (name: string) =>
  within(screen.getByRole("radiogroup", { name: "A quién va la transferencia" })).getByRole("radio", {
    name,
  });
const save = () => userEvent.click(screen.getByRole("button", { name: "Guardar transferencia" }));
const posted = (requests: Request[]) => requests.find((r) => r.method === "POST")!.json();

describe("Transferencia to or from someone (P334)", () => {
  it("keeps Tus cuentas as before: Desde and Hacia, a transfer between the recorder's own accounts", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/transfers": () => jsonResponse(transactionDto({ id: "t-1" }), 201),
    });
    form(api);
    expect(mode("Tus cuentas")).toBeChecked();
    expect(screen.getByRole("button", { name: /Desde/ })).toHaveTextContent("Bancolombia");
    await userEvent.type(screen.getByLabelText("Monto"), "50000");
    await userEvent.click(screen.getByRole("button", { name: /Hacia/ }));
    await userEvent.click(await screen.findByRole("radio", { name: /Nequi/ }));
    await save();
    expect(await posted(requests)).toMatchObject({
      sourceAccountId: "a-bank",
      destinationAccountId: "a-nequi",
    });
  });

  it("A alguien: Juan in your space, the card says it settles your debt and Juan ends up owing you", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/balances/suggestions": () => owing("ANA"),
      "POST /api/v1/spaces/{spaceId}/settlements": settled,
    });
    const { container } = form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "150000");
    await userEvent.click(mode("A alguien"));
    expect(await screen.findByRole("button", { name: /A Juan/ })).toHaveTextContent("A quién");
    expect(screen.getByRole("button", { name: /Desde Bancolombia/ })).toHaveTextContent("Tu cuenta");
    expect(screen.queryByRole("button", { name: /Hacia/ })).not.toBeInTheDocument();
    const space = screen.getByRole("button", { name: /En Ana & Juan/ });
    await waitFor(() => expect(space).toHaveTextContent("Espacio · ahí le debías 100.000 COP"));
    const card = screen.getByRole("status");
    expect(card).toHaveTextContent("Saldas tu deuda de 100.000 COP y Juan queda debiéndote 50.000 COP.");
    expect(card).toHaveTextContent("Solo en el espacio Ana & Juan.");
    expect(await axeViolations(container)).toEqual([]);
    await save();
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    const request = requests.find((r) => r.method === "POST")!;
    expect(new URL(request.url).pathname).toBe("/api/v1/spaces/sp-ana-juan/settlements");
    expect(await request.json()).toMatchObject({
      amount: cop(150_000),
      payerMemberId: "m-ana-d",
      receivingMemberId: "m-juan-d",
      sourceAccountId: "a-bank",
    });
    expect(router.replace).toHaveBeenCalledWith("/spaces/sp-ana-juan/transactions", { scroll: false });
  });

  it("De alguien: Juan pays part of what he owes into Ana's account", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/balances/suggestions": () => owing("JUAN"),
      "POST /api/v1/spaces/{spaceId}/settlements": settled,
    });
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "50000");
    await userEvent.click(mode("De alguien"));
    expect(await screen.findByRole("button", { name: /De Juan/ })).toHaveTextContent("De quién");
    expect(screen.getByRole("button", { name: /Hacia Bancolombia/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Juan abona 50.000 COP a su deuda contigo; aún te debe 50.000 COP.",
      ),
    );
    await save();
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect(await posted(requests)).toMatchObject({
      payerMemberId: "m-juan-d",
      receivingMemberId: "m-ana-d",
      destinationAccountId: "a-bank",
    });
  });

  it("with Luis, their space is made on save: nobody owed anything there, and the request names Luis", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/balances/suggestions": () => owing("ANA"),
      "POST /api/v1/direct-settlements": () =>
        jsonResponse(
          {
            spaceId: "sp-ana-luis",
            created: true,
            settlement: transactionDto({ id: "t-2", type: "SETTLEMENT" }),
          },
          201,
        ),
    });
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "150000");
    await userEvent.click(mode("A alguien"));
    await userEvent.click(await screen.findByRole("button", { name: /A Juan/ }));
    await userEvent.click(await screen.findByRole("radio", { name: "Luis" }));
    const space = screen.getByRole("button", { name: /En Tu espacio con Luis/ });
    expect(space).toHaveTextContent("Espacio · ahí no se debían nada");
    expect(screen.getByRole("status")).toHaveTextContent("Luis queda debiéndote 150.000 COP.");
    await save();
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    const request = requests.find((r) => r.method === "POST")!;
    expect(new URL(request.url).pathname).toBe("/api/v1/direct-settlements");
    expect(await request.json()).toMatchObject({
      counterpart: { kind: "MEMBER", memberId: "m-luis" },
      direction: "TO",
      accountId: "a-bank",
      amount: cop(150_000),
    });
    expect(router.replace).toHaveBeenCalledWith("/spaces/sp-ana-luis/transactions", { scroll: false });
  });
});

describe("the effect card follows the person, not only the space (P334)", () => {
  it("reads Luis's debt, not Juan's, after switching from Juan to Luis in the same group", async () => {
    const inHousehold = (memberId: string, name: string): Person => ({
      memberId,
      name,
      isGuest: false,
      directSpace: null,
      places: [
        {
          spaceId: "sp-household",
          name: "Household",
          kind: "SHARED",
          currency: "COP",
          theirMemberId: memberId,
          myMemberId: "m-ana",
        },
      ],
    });
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/balances/suggestions": () =>
        jsonResponse({
          spaceId: "sp-household",
          currency: "COP",
          suggestions: [{ payerMemberId: "m-ana", receivingMemberId: "m-juan", amount: cop(100_000) }],
        }),
    });
    renderWithIntl(
      <RecordForm
        space={spaceDto()}
        accounts={accounts}
        groups={[groupDto()]}
        formats={BUILT_IN_FORMATS}
        initialKind="TRANSFER"
        initialNow="2026-11-01T04:30:00.000Z"
        timeZone="America/Bogota"
        people={[inHousehold("m-juan", "Juan"), inHousehold("m-luis", "Luis")]}
        api={api}
      />,
    );
    await userEvent.type(screen.getByLabelText("Monto"), "150000");
    await userEvent.click(mode("A alguien"));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Saldas tu deuda de 100.000 COP y Juan queda debiéndote 50.000 COP.",
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: /A Juan/ }));
    await userEvent.click(await screen.findByRole("radio", { name: "Luis" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Luis queda debiéndote 150.000 COP."),
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("100.000");
  });
});

describe("the places a transfer can go (P334)", () => {
  it("leaves out a group whose currency is not the account's", async () => {
    const juan: Person = {
      memberId: "m-juan-d",
      name: "Juan",
      isGuest: false,
      directSpace: "Ana & Juan",
      places: [
        {
          spaceId: "sp-ana-juan",
          name: "Ana & Juan",
          kind: "DIRECT",
          currency: "COP",
          theirMemberId: "m-juan-d",
          myMemberId: "m-ana-d",
        },
        {
          spaceId: "sp-trip",
          name: "Trip",
          kind: "SHARED",
          currency: "USD",
          theirMemberId: "m-juan-t",
          myMemberId: "m-ana-t",
        },
      ],
    };
    const { api } = fakeApi({ "GET /api/v1/spaces/{spaceId}/balances/suggestions": () => owing("ANA") });
    renderWithIntl(
      <RecordForm
        space={spaceDto()}
        accounts={accounts}
        groups={[groupDto()]}
        formats={BUILT_IN_FORMATS}
        initialKind="TRANSFER"
        initialNow="2026-11-01T04:30:00.000Z"
        timeZone="America/Bogota"
        people={[juan]}
        api={api}
      />,
    );
    await userEvent.click(mode("A alguien"));
    await userEvent.click(await screen.findByRole("button", { name: /En Ana & Juan/ }));
    const sheet = await screen.findByRole("dialog", { name: "¿En qué espacio?" });
    expect(
      within(sheet)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Ana & Juan"]);
  });
});
