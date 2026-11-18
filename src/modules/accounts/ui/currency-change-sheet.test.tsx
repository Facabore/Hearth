import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { accountDto, cop, spaceDto } from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { enableSheetHistory, sheetDepth } from "@/shared/ui/navigation/sheet-gate";
import { CurrencyChangeSheet } from "./currency-change-sheet";
import { EditAccountForm } from "./edit-account-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn(), back: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, notFound: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

const usd = (amount: number) => ({ amount: String(amount), currency: "USD" });
/** Board "Cambiar moneda · tasa · hoja": "Cuenta en dólares", 512,40 USD today. */
const dollars = accountDto({
  id: "a-usd",
  name: "Cuenta en dólares",
  openingBalance: usd(12_000),
  balance: usd(51_240),
});
const PREVIEW = "GET /api/v1/spaces/{spaceId}/accounts/{accountId}/currency";
const CHANGE = "PUT /api/v1/spaces/{spaceId}/accounts/{accountId}/currency";
/** What the server answers for a rate: 512,40 USD at it, in COP minor units. */
const previewAt = (rate: string | null, rateDate: string | null = null) => ({
  from: "USD",
  to: "COP",
  rate,
  rateDate,
  movements: 48,
  balanceBefore: usd(51_240),
  balanceAfter: rate === null ? null : cop((512.4 * Number(rate)) | 0),
});

const renderSheet = (api: ReturnType<typeof fakeApi>["api"], onChanged = vi.fn()) =>
  renderWithIntl(
    <CurrencyChangeSheet
      open
      onOpenChange={vi.fn()}
      spaceId="sp-personal"
      account={dollars}
      to="COP"
      formats={BUILT_IN_FORMATS}
      api={api}
      onChanged={onChanged}
    />,
  );

describe("changing an account's currency (P336)", () => {
  it("offers the latest stored rate, says its day, and shows the balance before and after", async () => {
    const { api } = fakeApi({ [PREVIEW]: () => jsonResponse(previewAt("4000", "2026-11-15")) });
    const { baseElement } = renderSheet(api);
    expect(await screen.findByLabelText("Tasa")).toHaveValue("4.000");
    expect(screen.getByRole("dialog", { name: "Nueva moneda: Peso colombiano (COP)" })).toBeInTheDocument();
    expect(screen.getByText(/La tasa del 15 nov 2026\. Puedes cambiarla/)).toBeInTheDocument();
    expect(screen.getByText("Saldo hoy: 512,40 USD → 2.049.600 COP")).toBeInTheDocument();
    expect(
      screen.getByText("Sus 48 movimientos y el saldo inicial se convierten con esta tasa."),
    ).toBeInTheDocument();
    expect(await axeViolations(baseElement)).toEqual([]);
  });

  it("follows the rate typed and sends it as a plain decimal", async () => {
    const onChanged = vi.fn();
    const { api, requests } = fakeApi({
      [PREVIEW]: (request) => {
        const rate = new URL(request.url).searchParams.get("rate");
        return jsonResponse(rate === null ? previewAt("4000", "2026-11-15") : previewAt(rate));
      },
      [CHANGE]: () => jsonResponse(dollars),
    });
    renderSheet(api, onChanged);
    const field = await screen.findByLabelText("Tasa");
    await userEvent.clear(field);
    await userEvent.type(field, "4020,5");
    expect(await screen.findByText("Saldo hoy: 512,40 USD → 2.060.104 COP")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cambiar a COP" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const put = requests.find((r) => r.method === "PUT")!;
    expect(await put.json()).toEqual({ currency: "COP", rate: "4020.5" });
  });

  it("with no stored rate leaves the field empty, asks for one, and does not change until it is typed", async () => {
    const { api } = fakeApi({
      [PREVIEW]: (request) => {
        const rate = new URL(request.url).searchParams.get("rate");
        return jsonResponse(previewAt(rate));
      },
    });
    renderSheet(api);
    expect(await screen.findByText(/No tenemos una tasa entre estas monedas/)).toBeInTheDocument();
    expect(screen.getByLabelText("Tasa")).toHaveValue("");
    expect(screen.getByText(/Escribe la tasa para ver el saldo en COP/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cambiar a COP" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Tasa"), "1");
    // A rate of 1 only changes the currency: 512,40 USD becomes 512 COP.
    expect(await screen.findByText("Saldo hoy: 512,40 USD → 512 COP")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cambiar a COP" })).toBeEnabled();
  });

  it("Editar cuenta shows the account's currency and says its movements convert", () => {
    const { api } = fakeApi({});
    renderWithIntl(
      <EditAccountForm space={spaceDto()} account={dollars} formats={BUILT_IN_FORMATS} api={api} />,
    );
    expect(screen.getByRole("button", { name: /Moneda/ })).toHaveTextContent("USD");
    expect(screen.getByText(/Si la cambias, sus movimientos pasan a la nueva moneda/)).toBeInTheDocument();
  });

  it("opens the rate sheet over Editar cuenta once the currency sheet's history entry is given back (P307)", async () => {
    enableSheetHistory();
    const { api } = fakeApi({ [PREVIEW]: () => jsonResponse(previewAt("4000", "2026-11-15")) });
    renderWithIntl(
      <EditAccountForm space={spaceDto()} account={dollars} formats={BUILT_IN_FORMATS} api={api} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Moneda/ }));
    await userEvent.click(await screen.findByRole("button", { name: /Peso colombiano/ }));
    expect(
      await screen.findByRole("dialog", { name: "Nueva moneda: Peso colombiano (COP)" }),
    ).toBeInTheDocument();
    // The currency sheet's late Back must not close the rate sheet that opened after it.
    await waitFor(() => expect(sheetDepth()).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("dialog", { name: "Nueva moneda: Peso colombiano (COP)" })).toBeInTheDocument();
  });

  it("says at once when the server refuses the rate typed", async () => {
    const { api } = fakeApi({
      [PREVIEW]: (request) =>
        new URL(request.url).searchParams.get("rate") === null
          ? jsonResponse(previewAt("4000", "2026-11-15"))
          : problemResponse(422, "ConvertedAmountTooSmall"),
    });
    renderSheet(api);
    const field = await screen.findByLabelText("Tasa");
    await userEvent.clear(field);
    await userEvent.type(field, "0,0000001");
    expect(await screen.findByText(/algún movimiento de la cuenta quedaría en cero/)).toBeInTheDocument();
  });
});
