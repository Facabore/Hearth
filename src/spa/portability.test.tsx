import { File as NodeFile } from "node:buffer";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cop, householdSpace, meDto, normalized, spaceDto } from "../../tests/support/ui/dto";
import { jsonResponse, type FakeHandler } from "../../tests/support/ui/fake-api";
import { loadedAreas, renderSpa } from "../../tests/support/ui/spa";
import { previewFixture, resultFixture, summaryFixture } from "../modules/portability/ui/preview-fixture";

// jsdom's FormData and File are not the ones Node's fetch sends as multipart: the browser's are, so the test uses Node's.
const NodeFormData = (
  await new Response("a=b", { headers: { "content-type": "application/x-www-form-urlencoded" } }).formData()
).constructor as typeof FormData;

const HOUSEHOLD = "/spaces/sp-household";
const WAIT = { timeout: 5_000 };

/** Ana's personal space and Household, and the import API of her personal space, which records every call. */
const server = (overrides: Record<string, FakeHandler> = {}) => {
  const calls: string[] = [];
  const log =
    (handler: FakeHandler): FakeHandler =>
    (request, params) => {
      calls.push(`${request.method} ${new URL(request.url).pathname}`);
      return handler(request, params);
    };
  let confirmed = false;
  const routes: Record<string, FakeHandler> = {
    "GET /api/v1/me": () => jsonResponse(meDto()),
    "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
    "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto(), householdSpace({ name: "Hogar" })] }),
    "GET /api/v1/me/referrals": () =>
      jsonResponse({ code: "x", link: "http://hearth.test/r/x", points: 0, items: [] }),
    "GET /api/v1/spaces/{spaceId}/accounts": () =>
      jsonResponse({ items: [], totals: { available: cop(0), netWorth: cop(0) } }),
    "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: [] }),
    "GET /api/v1/spaces/{spaceId}/imports": log(() =>
      jsonResponse({ items: confirmed ? [summaryFixture()] : [] }),
    ),
    "POST /api/v1/spaces/{spaceId}/imports": log(() => jsonResponse(previewFixture(), 201)),
    "PATCH /api/v1/spaces/{spaceId}/imports/{importId}": log(() => jsonResponse(previewFixture())),
    "POST /api/v1/spaces/{spaceId}/imports/{importId}/confirm": log(() => {
      confirmed = true;
      return jsonResponse(resultFixture());
    }),
    ...overrides,
  };
  return { routes, calls };
};

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
  vi.stubGlobal("FormData", NodeFormData);
});
afterEach(() => vi.unstubAllGlobals());

describe("Importar y exportar in the app (D28, #326)", () => {
  it("goes from Más to the hub, uploads a backup, reviews it, confirms it and shows what it did", async () => {
    const { routes, calls } = server();
    const spa = renderSpa(`${HOUSEHOLD}/more`, routes);
    await userEvent.click(await screen.findByRole("link", { name: "Importar y exportar" }, WAIT));
    expect(await screen.findByRole("heading", { level: 1, name: "Importar y exportar" }, WAIT)).toBeVisible();
    expect(spa.location()).toBe(`${HOUSEHOLD}/data`);
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", `${HOUSEHOLD}/more`);
    expect(loadedAreas(spa)).toContain("es:portability");
    // The imports are the personal space's, whatever space Más was opened in.
    expect(new Set(calls)).toEqual(new Set(["GET /api/v1/spaces/sp-personal/imports"]));

    await userEvent.click(screen.getByRole("link", { name: /Money Manager/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Desde Money Manager" }, WAIT)).toBeVisible();
    await userEvent.upload(
      screen.getByLabelText("Copia de Money Manager"),
      new NodeFile(["SQLite format 3"], "money_android.mmbak") as unknown as File,
    );

    expect(await screen.findByRole("heading", { level: 1, name: "Revisar importación" }, WAIT)).toBeVisible();
    expect(spa.location()).toBe(`${HOUSEHOLD}/data/imports/imp-1`);
    expect(screen.getByText("1.240 movimientos")).toBeVisible();
    // The upload's answer is the review's: nothing asks for the preview again.
    expect(calls.filter((call) => call.startsWith("PATCH"))).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Importar 1.237 movimientos" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Importación lista" }, WAIT)).toBeVisible();
    expect(spa.location()).toBe(`${HOUSEHOLD}/data/imports/imp-1/done`);
    expect(screen.getByRole("heading", { level: 2, name: "Importamos 1.237 movimientos" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: /2 cuentas nuevas.*Visa Oro y Cuenta en dólares/ }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Ver movimientos" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/transactions",
    );
    expect(calls).toContain("POST /api/v1/spaces/sp-personal/imports");
    expect(calls).toContain("POST /api/v1/spaces/sp-personal/imports/imp-1/confirm");

    // The confirm replaced the review: Volver leaves for the hub, whose history now has the import.
    await userEvent.click(screen.getByRole("link", { name: "Volver" }));
    const history = await screen.findByRole("region", { name: "Importaciones anteriores" }, WAIT);
    await waitFor(() =>
      expect(normalized(within(history).getByText(/movimientos · en/).textContent)).toBe(
        "1.237 movimientos · en Personal",
      ),
    );
  });

  it("opens Descargar mis datos from the hub, with every space of the person's", async () => {
    const { routes } = server();
    renderSpa(`${HOUSEHOLD}/data`, routes);
    await userEvent.click(await screen.findByRole("link", { name: /Descargar mis datos/ }, WAIT));
    expect(await screen.findByRole("heading", { level: 1, name: "Descargar mis datos" }, WAIT)).toBeVisible();
    expect(screen.getByRole("radio", { name: /Todos mis espacios/ })).toHaveTextContent("Personal y Hogar");
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", `${HOUSEHOLD}/data`);
  });

  it("reads a draft's preview with an empty adjustment when the visit does not hold it", async () => {
    const bodies: unknown[] = [];
    const { routes } = server({
      "PATCH /api/v1/spaces/{spaceId}/imports/{importId}": async (request) => {
        bodies.push(await request.json());
        return jsonResponse(previewFixture());
      },
    });
    renderSpa(`${HOUSEHOLD}/data/imports/imp-1`, routes);
    expect(await screen.findByRole("heading", { level: 1, name: "Revisar importación" }, WAIT)).toBeVisible();
    expect(bodies).toEqual([{}]);
  });

  it("maps an account and shows the review with the new preview", async () => {
    const allExisting = previewFixture({
      accounts: previewFixture().accounts.map((a) => ({
        ...a,
        mapping: { kind: "existing" as const, accountId: "acc-bancolombia" },
      })),
    });
    let adjusted = false;
    const { routes } = server({
      "PATCH /api/v1/spaces/{spaceId}/imports/{importId}": () =>
        jsonResponse(adjusted ? allExisting : previewFixture()),
    });
    renderSpa(`${HOUSEHOLD}/data/imports/imp-1`, routes);
    await userEvent.click(await screen.findByRole("link", { name: /Cuentas.*3 · 2 nuevas/ }, WAIT));
    expect(await screen.findByRole("heading", { level: 1, name: "Cuentas a importar" }, WAIT)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Visa Oro: Dónde va esta cuenta" }));
    const sheet = await screen.findByRole("dialog", { name: "Visa Oro" }, WAIT);
    adjusted = true;
    await userEvent.click(within(sheet).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await userEvent.click(screen.getByRole("link", { name: "Listo" }));
    expect(
      await screen.findByRole("link", { name: /Cuentas.*3 · 0 nuevas, 3 ya las tienes/ }, WAIT),
    ).toBeVisible();
  });
});
