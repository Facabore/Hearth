import { File as NodeFile } from "node:buffer";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { es } from "@/i18n/messages/full";
import { cop, householdSpace, meDto, normalized, spaceDto } from "../../tests/support/ui/dto";
import { jsonResponse, problemResponse, type FakeHandler } from "../../tests/support/ui/fake-api";
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
    expect(
      await screen.findByRole("heading", { level: 2, name: "¿Qué es cada cuenta?" }, WAIT),
    ).toBeVisible();
    adjusted = true;
    const visa = screen.getByRole("group", { name: "Qué es Visa Oro" });
    await userEvent.click(within(visa).getByRole("button", { name: "Persona" }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("group", { name: "Qué es Visa Oro" })).getByRole("button", {
          name: "Cuenta",
        }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    await userEvent.click(screen.getByRole("link", { name: "Continuar" }));
    expect(
      await screen.findByRole("link", { name: /Cuentas.*3 · 0 nuevas, 3 ya las tienes/ }, WAIT),
    ).toBeVisible();
  });
});

describe("Importar y exportar's refusals, later visits and undo (D28, #326)", () => {
  const MM = `${HOUSEHOLD}/data/money-manager`;
  const REVIEW = `${HOUSEHOLD}/data/imports/imp-1`;
  const UNDO = "POST /api/v1/spaces/{spaceId}/imports/{importId}/undo";
  const undone = () =>
    jsonResponse({
      id: "imp-1",
      status: "UNDONE",
      movementsDeleted: 1237,
      accountsArchived: 2,
      categoriesArchived: 2,
    });

  it("keeps an upload the API refuses on its screen, with the refusal's message", async () => {
    const { routes } = server({
      "POST /api/v1/spaces/{spaceId}/imports": () => problemResponse(422, "UnreadableBackup"),
    });
    const spa = renderSpa(MM, routes);
    await userEvent.upload(
      await screen.findByLabelText("Copia de Money Manager", undefined, WAIT),
      new NodeFile(["not sqlite"], "money.mmbak") as unknown as File,
    );
    expect(await screen.findByText(es.errors.UnreadableBackup, undefined, WAIT)).toBeVisible();
    expect(spa.location()).toBe(MM);
  });

  it("keeps a confirm the API refuses on the review, naming the source it is about", async () => {
    const { routes } = server({
      "POST /api/v1/spaces/{spaceId}/imports/{importId}/confirm": () =>
        problemResponse(409, "ImportTargetRefused", { sourceId: "a-2", reason: "AccountNameTaken" }),
    });
    const spa = renderSpa(REVIEW, routes);
    await userEvent.click(await screen.findByRole("button", { name: "Importar 1.237 movimientos" }, WAIT));
    expect(await screen.findByText("Es sobre «Visa Oro».", undefined, WAIT)).toBeVisible();
    expect(spa.location()).toBe(REVIEW);
  });

  it("answers a draft that is not the person's as not found", async () => {
    const { routes } = server({
      "PATCH /api/v1/spaces/{spaceId}/imports/{importId}": () => problemResponse(404, "ImportNotFound"),
    });
    renderSpa(`${HOUSEHOLD}/data/imports/imp-someone`, routes);
    expect(await screen.findByRole("heading", { name: es.notFound.title }, WAIT)).toBeVisible();
  });

  it("opens what a draft confirmed elsewhere did, from the history's counts alone", async () => {
    const { routes } = server({
      "GET /api/v1/spaces/{spaceId}/imports": () => jsonResponse({ items: [summaryFixture()] }),
      "PATCH /api/v1/spaces/{spaceId}/imports/{importId}": () => problemResponse(409, "ImportNotDraft"),
    });
    const spa = renderSpa(REVIEW, routes);
    expect(await screen.findByRole("heading", { level: 1, name: "Importación lista" }, WAIT)).toBeVisible();
    expect(spa.location()).toBe(`${REVIEW}/done`);
    expect(screen.getByRole("heading", { level: 2, name: "Importamos 1.237 movimientos" })).toBeVisible();
    // A later visit has no preview: the counts, never the names or the dates.
    expect(screen.getByText("En Personal.")).toBeVisible();
    expect(screen.getByRole("link", { name: /^2 cuentas nuevas$/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Deshacer importación" })).toBeVisible();
  });

  it("undoes an import from the hub, says so and reads the history again", async () => {
    let isUndone = false;
    let historyReads = 0;
    const { routes } = server({
      "GET /api/v1/spaces/{spaceId}/imports": () => {
        historyReads += 1;
        return jsonResponse({
          items: [summaryFixture(isUndone ? { status: "UNDONE", undoneAt: "2026-11-16T10:00:00.000Z" } : {})],
        });
      },
      [UNDO]: () => ((isUndone = true), undone()),
    });
    renderSpa(`${HOUSEHOLD}/data`, routes);
    await userEvent.click(await screen.findByRole("button", { name: /^Deshacer: / }, WAIT));
    const sheet = await screen.findByRole("dialog", { name: "¿Deshacer esta importación?" }, WAIT);
    const before = historyReads;
    await userEvent.click(within(sheet).getByRole("button", { name: "Deshacer importación" }));
    await waitFor(
      () => expect(screen.getByRole("status")).toHaveTextContent("Deshicimos la importación."),
      WAIT,
    );
    await waitFor(() => expect(historyReads).toBeGreaterThan(before));
    expect(await screen.findByText("Deshecha", undefined, WAIT)).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Deshacer: / })).toBeNull();
  });

  it("undoes an import from its done screen and goes back to the hub", async () => {
    let isUndone = false;
    const { routes } = server({
      "GET /api/v1/spaces/{spaceId}/imports": () =>
        jsonResponse({ items: [summaryFixture(isUndone ? { status: "UNDONE" } : {})] }),
      [UNDO]: () => ((isUndone = true), undone()),
    });
    const spa = renderSpa(`${REVIEW}/done`, routes);
    await userEvent.click(await screen.findByRole("button", { name: "Deshacer importación" }, WAIT));
    const sheet = await screen.findByRole("dialog", { name: "¿Deshacer esta importación?" }, WAIT);
    await userEvent.click(within(sheet).getByRole("button", { name: "Deshacer importación" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Importar y exportar" }, WAIT)).toBeVisible();
    expect(spa.location()).toBe(`${HOUSEHOLD}/data`);
    await waitFor(
      () => expect(screen.getByRole("status")).toHaveTextContent("Deshicimos la importación."),
      WAIT,
    );
    expect(await screen.findByText("Deshecha", undefined, WAIT)).toBeVisible();
  });

  it("maps a category from its screen and shows the review with the new preview", async () => {
    const otros = { id: "grp-otros", name: "Otros", key: "other", archivedAt: null, color: "SAGE" as const };
    const icon = { kind: "SYMBOL" as const, name: "dots" };
    const toImportGroup = previewFixture({
      categories: previewFixture().categories.map((c) =>
        c.sourceId === "c-misc"
          ? { ...c, mapping: { kind: "new" as const, groupId: null, name: "Varios" } }
          : c,
      ),
    });
    const bodies: unknown[] = [];
    const { routes } = server({
      "GET /api/v1/spaces/{spaceId}/categories": () =>
        jsonResponse({ items: [{ ...otros, icon, categories: [] }] }),
      "PATCH /api/v1/spaces/{spaceId}/imports/{importId}": async (request) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        return jsonResponse(body.categories ? toImportGroup : previewFixture());
      },
    });
    renderSpa(REVIEW, routes);
    await userEvent.click(await screen.findByRole("link", { name: /Categorías.*Revisar/ }, WAIT));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Categorías a importar" }, WAIT),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: /^Varios/ }));
    const sheet = await screen.findByRole("dialog", { name: "Varios" }, WAIT);
    await userEvent.click(within(sheet).getByRole("radio", { name: "Grupo de la importación" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: /^Varios/ })).toHaveTextContent(
      "Nueva en Grupo de la importación",
    );
    expect(bodies.at(-1)).toEqual({
      categories: { "c-misc": { kind: "new", groupId: null, name: "Varios" } },
    });
    await userEvent.click(screen.getByRole("link", { name: "Listo" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Revisar importación" }, WAIT)).toBeVisible();
  });
});
