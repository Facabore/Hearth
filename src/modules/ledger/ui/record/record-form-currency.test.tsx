import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountDto, groupDto, spaceDto, transactionDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { RecordForm } from "./record-form";
import type { RecordKind } from "./record-request";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T04:30:00Z"));
});
afterEach(() => vi.useRealTimers());

// A personal space in COP, with a USD account (board 9's "a USD expense on a COP card") and a COP one.
const accounts = [
  accountDto({ id: "a-chase", name: "Chase", type: "BANK", balance: { amount: "0", currency: "USD" } }),
  accountDto({ id: "a-bank", name: "Bancolombia", type: "BANK", balance: { amount: "0", currency: "COP" } }),
];
const form = (api: Api, kind: RecordKind = "EXPENSE") =>
  renderWithIntl(
    <RecordForm
      space={spaceDto()}
      accounts={accounts}
      groups={[groupDto()]}
      formats={BUILT_IN_FORMATS}
      initialKind={kind}
      initialNow="2026-11-01T04:30:00.000Z"
      timeZone="America/Bogota"
      api={api}
    />,
  );
const posted = (requests: Request[]) => requests.find((r) => r.method === "POST")!.json();

describe("recording in another currency (D29, board 9)", () => {
  it("offers the account's currency and sends the bank's converted base amount", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/expenses": () => jsonResponse(transactionDto({ id: "t-usd" }), 201),
    });
    form(api);
    // The amount is typed in the account's own currency (US$), and the converted-amount field appears.
    await userEvent.type(screen.getByLabelText("Monto"), "50");
    const converted = screen.getByLabelText("Lo que te cobró el banco (en COP)");
    await userEvent.type(converted, "205000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(await posted(requests)).toMatchObject({
      amount: { amount: "5000", currency: "USD" },
      convertedAmount: { amount: "20500000", currency: "COP" },
      accountId: "a-chase",
    });
  });

  it("sends no converted amount when the base amount is left blank", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/expenses": () => jsonResponse(transactionDto({ id: "t-usd" }), 201),
    });
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "50");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    const body = (await posted(requests)) as Record<string, unknown>;
    expect(body.amount).toEqual({ amount: "5000", currency: "USD" });
    expect("convertedAmount" in body).toBe(false);
  });

  it("shows ExchangeRateRequired as an error asking for the converted amount", async () => {
    const { api } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/expenses": () => problemResponse(422, "ExchangeRateRequired"),
    });
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "50");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Lo que te cobró el banco (en COP)")).toHaveAccessibleDescription(/.+/),
    );
    expect(screen.getByLabelText("Lo que te cobró el banco (en COP)")).toBeInvalid();
  });

  it("stays in the base currency for an account in the space currency (no converted field)", async () => {
    const { api } = fakeApi({});
    form(api);
    // Move the account to the COP one: no converted field then.
    await userEvent.click(screen.getByRole("button", { name: /Quién pagó y para quién/ }));
    await userEvent.click(await screen.findByRole("radio", { name: /Bancolombia/ }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByLabelText(/Lo que te cobró el banco/)).toBeNull();
  });
});

describe("transfer across currencies (D29, board 10)", () => {
  it("asks what leaves (Sale) and what arrives (Llega) and sends the destination amount", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/transfers": () => jsonResponse(transactionDto({ id: "t-x" }), 201),
    });
    form(api, "TRANSFER");
    // The source (a-chase, USD) is the default; choose the COP destination.
    await userEvent.type(screen.getByLabelText("Monto"), "100");
    await userEvent.click(screen.getByRole("button", { name: /Hacia/ }));
    await userEvent.click(await screen.findByRole("radio", { name: /Bancolombia/ }));
    await userEvent.type(screen.getByLabelText("Llega"), "400000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar transferencia" }));
    expect(await posted(requests)).toMatchObject({
      amount: { amount: "10000", currency: "USD" },
      destinationAmount: { amount: "40000000", currency: "COP" },
      sourceAccountId: "a-chase",
      destinationAccountId: "a-bank",
    });
  });
});
