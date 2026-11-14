import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en, es } from "@/i18n/messages/full";
import type { AccountDto, CategoryGroupDto, MeDto, SpaceDto } from "@/shared/ui/api/dto";
import {
  accountDto,
  activityItemDto,
  categoryDto,
  cop,
  groupDto,
  householdSpace,
  meDto,
  normalized,
  octoberPage,
  patchedMe,
  spaceDto,
  transactionDto,
} from "../../tests/support/ui/dto";
import { jsonResponse, problemResponse, type FakeHandler } from "../../tests/support/ui/fake-api";
import { loadedAreas, renderSpa, speak, watchMissingMessages } from "../../tests/support/ui/spa";

const ACCOUNTS = "/spaces/sp-personal/accounts";

/** Ana's spaces, accounts, categories and profile over a fake /api/v1 that keeps what each write changed. */
const server = () => {
  const state: {
    me: MeDto;
    spaces: SpaceDto[];
    accounts: AccountDto[];
    groups: CategoryGroupDto[];
  } = {
    me: meDto(),
    spaces: [spaceDto(), householdSpace()],
    accounts: [
      accountDto({ id: "a-bank", name: "Bancolombia", balance: cop(1_000) }),
      accountDto({ id: "a-nequi", name: "Nequi", type: "WALLET", balance: cop(50) }),
    ],
    groups: [
      groupDto({
        id: "g-food",
        name: "Food",
        categories: [
          categoryDto({ id: "c-groceries", name: "Groceries", archivedAt: "2026-10-20T15:00:00.000Z" }),
          categoryDto({ id: "c-dining", name: "Restaurants" }),
        ],
      }),
    ],
  };
  const list = () => ({
    items: state.accounts,
    totals: { available: cop(1_050), netWorth: cop(1_050) },
  });
  const routes: Record<string, FakeHandler> = {
    "GET /api/v1/me": () => jsonResponse(state.me),
    "PATCH /api/v1/me": async (request) => {
      state.me = patchedMe((await request.json()) as Record<string, unknown>, state.me);
      return jsonResponse(state.me);
    },
    "GET /api/v1/spaces": () => jsonResponse({ items: state.spaces }),
    "POST /api/v1/spaces": async (request) => {
      const { name, periodPolicy } = (await request.json()) as Pick<SpaceDto, "name" | "periodPolicy">;
      const created = householdSpace({ id: "sp-new", name, periodPolicy });
      state.spaces = [...state.spaces, created];
      return jsonResponse(created, 201);
    },
    "PATCH /api/v1/spaces/{spaceId}": async (request, { spaceId }) => {
      const { name } = (await request.json()) as { name: string };
      state.spaces = state.spaces.map((space) => (space.id === spaceId ? { ...space, name } : space));
      return jsonResponse(state.spaces.find((space) => space.id === spaceId));
    },
    "GET /api/v1/auth/sign-up": () => jsonResponse({ signUp: "open" }),
    "GET /api/v1/spaces/{spaceId}/accounts": () => jsonResponse(list()),
    "GET /api/v1/spaces/{spaceId}/accounts/{accountId}": (_, { accountId }) => {
      const account = state.accounts.find((one) => one.id === accountId);
      return account ? jsonResponse(account) : problemResponse(404, "AccountNotFound");
    },
    "POST /api/v1/spaces/{spaceId}/accounts": async (request) => {
      const body = (await request.json()) as { name: string; type: AccountDto["type"] };
      const created = accountDto({ id: "a-new", name: body.name, type: body.type });
      state.accounts = [...state.accounts, created];
      return jsonResponse(created, 201);
    },
    "PATCH /api/v1/spaces/{spaceId}/accounts/{accountId}": async (request, { accountId }) => {
      const body = (await request.json()) as { name?: string };
      state.accounts = state.accounts.map((a) => (a.id === accountId ? { ...a, ...body } : a));
      return jsonResponse(state.accounts.find((account) => account.id === accountId));
    },
    "POST /api/v1/spaces/{spaceId}/accounts/{accountId}/archive": (_, { accountId }) => {
      state.accounts = state.accounts.map((a) =>
        a.id === accountId ? { ...a, archivedAt: "2026-10-28T12:00:00.000Z" } : a,
      );
      return jsonResponse(state.accounts.find((account) => account.id === accountId));
    },
    "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: state.groups }),
    "POST /api/v1/spaces/{spaceId}/categories/{categoryId}/restore": (_, { categoryId }) => {
      state.groups = state.groups.map((group) => ({
        ...group,
        categories: group.categories.map((c) => (c.id === categoryId ? { ...c, archivedAt: null } : c)),
      }));
      return jsonResponse(categoryDto({ id: categoryId, name: "Groceries" }));
    },
    "GET /api/v1/spaces/{spaceId}/transactions": () => jsonResponse(octoberPage),
    // Ruling P319: the person has another space, so her personal Movimientos reads every space.
    "GET /api/v1/me/transactions": () =>
      jsonResponse({
        period: octoberPage.period,
        totals: { share: octoberPage.totals.expenses, income: octoberPage.totals.income },
        items: [],
        nextCursor: null,
      }),
    "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: [] }),
    "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [] }),
  };
  return { routes, state };
};

const count = (requests: Request[], method: string, path: RegExp) =>
  requests.filter((r) => r.method === method && path.test(new URL(r.url).pathname)).length;

/** The reads none of these writes change: the profile, the spaces, the ledger. */
const untouched = (requests: Request[], except: RegExp[] = []) =>
  [/\/me$/, /\/spaces$/, /\/transactions$/, /\/categories$/, /\/accounts$/]
    .filter((path) => !except.some((skip) => skip.source === path.source))
    .map((path) => count(requests, "GET", path));

beforeEach(() => {
  document.cookie = "hearth.locale=es; path=/";
});

describe("accounts, categories and settings in the SPA (slice 3 of #199, ADR 0006)", () => {
  it("lists the space's accounts and creates one: saving lands on the list, which reads its accounts again", async () => {
    const { routes } = server();
    const spa = renderSpa(ACCOUNTS, routes);
    // The first screen of the file also waits for its modules to be transformed, which a browser never does.
    expect(await screen.findByText("Nequi", {}, { timeout: 5_000 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: es.accounts.title })).toBeVisible();
    expect(document.title).toBe(`${es.accounts.title} · Hearth`);

    await spa.router.navigate({ href: `${ACCOUNTS}/new` });
    await userEvent.click(await screen.findByRole("radio", { name: "Efectivo" }));
    await userEvent.type(screen.getByLabelText("Nombre"), "Caja");
    await userEvent.type(screen.getByLabelText("Saldo inicial"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));

    await waitFor(() => expect(spa.location()).toBe(ACCOUNTS));
    expect(await screen.findByText("Caja")).toBeInTheDocument();
  });

  it("returns from the record form's Nueva cuenta to the form with the new account chosen", async () => {
    const { routes, state } = server();
    state.accounts = [];
    const form = "/spaces/sp-personal/new";
    const spa = renderSpa(form, routes);
    expect(
      await screen.findByRole("button", { name: /Cuenta\s*Elegir cuenta/ }, { timeout: 5_000 }),
    ).toBeVisible();

    await spa.router.navigate({ href: `${ACCOUNTS}/new?returnTo=${encodeURIComponent(form)}` });
    await userEvent.click(await screen.findByRole("radio", { name: "Efectivo" }));
    await userEvent.type(screen.getByLabelText("Nombre"), "Wallet");
    await userEvent.type(screen.getByLabelText("Saldo inicial"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));

    await waitFor(() => expect(spa.location()).toBe(form));
    // The form picks its account when it opens, as it did on a fresh Next.js page: the new one is there already.
    expect(await screen.findByRole("button", { name: /Cuenta\s*Wallet/ })).toBeVisible();
  });

  it("hides an account from a confirmation on its own screen, through the app's own client (P292)", async () => {
    const { routes } = server();
    // From the list to the account's screen, as a person goes: the shell's first reads are settled by then.
    const spa = renderSpa(ACCOUNTS, routes);
    expect(await screen.findByText("Nequi", {}, { timeout: 5_000 })).toBeInTheDocument();
    await spa.router.navigate({ href: `${ACCOUNTS}/a-nequi/edit` });
    await userEvent.click(await screen.findByRole("button", { name: "Ocultar Nequi" }));
    const sheet = screen.getByRole("dialog", { name: "¿Ocultar Nequi?" });
    const before = untouched(spa.requests, [/\/accounts$/]);
    await userEvent.click(within(sheet).getByRole("button", { name: "Ocultar" }));

    // The archive went through the app's fake API, and the list it lands on moved it to its archived section.
    await waitFor(() => expect(spa.location()).toBe(ACCOUNTS));
    expect(await screen.findByRole("button", { name: "Mostrar Nequi" })).toBeInTheDocument();
    expect(count(spa.requests, "POST", /\/accounts\/a-nequi\/archive$/)).toBe(1);
    expect(untouched(spa.requests, [/\/accounts$/])).toEqual(before);
  });

  it("edits an account and returns to the list with its new name", async () => {
    const { routes } = server();
    const spa = renderSpa(`${ACCOUNTS}/a-nequi/edit`, routes);
    const name = await screen.findByLabelText("Nombre");
    expect(document.title).toBe(`${es.accounts.edit.title} · Hearth`);
    await userEvent.clear(name);
    await userEvent.type(name, "Nequi Ana");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(spa.location()).toBe(ACCOUNTS));
    expect(await screen.findByText("Nequi Ana")).toBeInTheDocument();
  });

  it("restores an archived category, and only the categories are read again", async () => {
    const { routes } = server();
    const spa = renderSpa("/spaces/sp-personal/categories", routes);
    expect(await screen.findByRole("heading", { level: 1, name: es.categories.title })).toBeVisible();
    const before = untouched(spa.requests, [/\/categories$/]);
    const reads = count(spa.requests, "GET", /\/categories$/);

    await userEvent.click(screen.getByRole("button", { name: "Restaurar Groceries" }));

    await waitFor(() => expect(count(spa.requests, "GET", /\/categories$/)).toBeGreaterThan(reads));
    expect(screen.queryByRole("button", { name: "Restaurar Groceries" })).not.toBeInTheDocument();
    expect(untouched(spa.requests, [/\/categories$/])).toEqual(before);
  });

  it("changes a format in Settings and every screen formats with it, without reading the profile again", async () => {
    const { routes } = server();
    const spa = renderSpa("/settings?from=sp-household", routes);
    // N3: Volver returns to the space the person came from; Settings is a stacked screen, without the switcher (P272).
    expect(await screen.findByRole("link", { name: es.common.back })).toHaveAttribute(
      "href",
      "/spaces/sp-household",
    );
    const profile = count(spa.requests, "GET", /\/me$/);

    // U8 (#224): the formats sit in the "Números y fechas" sheet.
    await userEvent.click(screen.getByRole("button", { name: /^Números y fechas/ }));
    await userEvent.click(await screen.findByRole("radio", { name: "1,234,567.89" }));
    await waitFor(() => expect(count(spa.requests, "PATCH", /\/me$/)).toBe(1));
    await spa.router.navigate({ href: "/spaces/sp-personal/transactions" });

    expect(await screen.findByText(/245,000/)).toBeInTheDocument();
    expect(count(spa.requests, "GET", /\/me$/)).toBe(profile);
  });

  it("keeps Settings for the person and the app: a space's name is not there (ruling P309)", async () => {
    const { routes } = server();
    renderSpa("/settings?from=sp-household", routes);
    expect(await screen.findByRole("button", { name: /^Números y fechas/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre del espacio")).not.toBeInTheDocument();
  });

  it("opens a space's Configuración from the header's ⚙, with its screens and a way back (rulings P309, P311)", async () => {
    const { routes } = server();
    const spa = renderSpa("/spaces/sp-household", routes);
    await userEvent.click(await screen.findByRole("link", { name: "Configuración de Household" }));
    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-household/settings"));
    expect(await screen.findByRole("heading", { level: 1, name: "Configuración" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Household" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Miembros e invitados/ })).toHaveAttribute(
      "href",
      "/spaces/sp-household/members",
    );
    expect(screen.getByRole("link", { name: es.common.back })).toHaveAttribute(
      "href",
      "/spaces/sp-household",
    );
  });

  it("renames the space in its own settings and the shell of a tab shows the new name at once (#167, P309)", async () => {
    const { routes } = server();
    const spa = renderSpa("/spaces/sp-personal/settings", routes);
    // Ruling P311: the name sits behind its row of the flat list, "Nombre" in the personal space.
    await userEvent.click(await screen.findByRole("button", { name: "Nombre" }));
    const field = await screen.findByLabelText("Nombre del espacio");
    await userEvent.clear(field);
    await userEvent.type(field, "Mis finanzas");
    await userEvent.tab();
    await waitFor(() => expect(count(spa.requests, "PATCH", /\/spaces\/sp-personal$/)).toBe(1));
    // The space's settings are a stacked screen without the switcher (ruling P272): a tab's shell names the new name.
    await spa.router.navigate({ href: "/spaces/sp-personal/transactions" });

    expect(
      await screen.findByRole("button", { name: es.shell.space.current.replace("{name}", "Mis finanzas") }),
    ).toBeVisible();
  });

  it("creates a shared space, which the person's spaces hold before the form lands in it", async () => {
    const { routes } = server();
    const spa = renderSpa("/spaces/new", routes);
    await userEvent.type(await screen.findByLabelText("Nombre"), "Casa");
    await userEvent.click(screen.getByRole("button", { name: "Crear espacio" }));

    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-new/members"));
    expect(
      (spa.queryClient.getQueryData<SpaceDto[]>(["spaces", "list"]) ?? []).map((space) => space.name),
    ).toContain("Casa");
  });

  it("creates a shared space counted twice a month, as the sheet's period controls set it (#240)", async () => {
    const { routes } = server();
    const spa = renderSpa("/spaces/new", routes);
    await userEvent.type(await screen.findByLabelText("Nombre"), "Casa");
    await userEvent.click(screen.getByRole("radio", { name: es.spaces.new.periodKind.SEMI_MONTHLY }));
    const first = screen.getByRole("textbox", { name: es.spaces.new.cutDay.day1 });
    const second = screen.getByRole("textbox", { name: es.spaces.new.cutDay.day2 });
    await userEvent.clear(first);
    await userEvent.type(first, "5");
    await userEvent.clear(second);
    await userEvent.type(second, "20");
    await userEvent.click(screen.getByRole("button", { name: "Crear espacio" }));

    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-new/members"));
    // The fake API creates the space with the policy the request carried, and the person's spaces hold it.
    expect(
      (spa.queryClient.getQueryData<SpaceDto[]>(["spaces", "list"]) ?? []).find(
        (space) => space.id === "sp-new",
      )?.periodPolicy,
    ).toEqual({ kind: "SEMI_MONTHLY", day1: 5, day2: 20 });
  });

  it("creates a shared space from the switcher's own sheet and lands in it with the sheet closed (E9-05 · 07)", async () => {
    const { routes } = server();
    const spa = renderSpa("/spaces/sp-personal/transactions", routes);
    await userEvent.click(
      await screen.findByRole(
        "button",
        { name: es.shell.space.current.replace("{name}", "Personal") },
        { timeout: 5_000 },
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: es.shell.space.create }));
    const sheet = screen.getByRole("dialog", { name: es.spaces.new.title });
    await userEvent.type(await within(sheet).findByLabelText("Nombre"), "Casa");
    await userEvent.click(within(sheet).getByRole("button", { name: "Crear espacio" }));

    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-new/members"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The screen the sheet opened over stays in the history, under the new space.
    spa.router.history.back();
    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-personal/transactions"));
  });

  it("opens a pasted invitation link from the switcher's Unirme con un enlace (Pantallas nuevas · 11)", async () => {
    const { routes } = server();
    const spa = renderSpa("/spaces/sp-personal/transactions", routes);
    await userEvent.click(
      await screen.findByRole(
        "button",
        { name: es.shell.space.current.replace("{name}", "Personal") },
        { timeout: 5_000 },
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: es.shell.space.join }));
    const sheet = screen.getByRole("dialog", { name: es.spaces.join.title });
    await userEvent.type(
      await within(sheet).findByLabelText(es.spaces.join.link),
      "https://hearth.example/invitations/AbC123",
    );
    await userEvent.click(within(sheet).getByRole("button", { name: es.spaces.join.submit }));

    await waitFor(() => expect(spa.location()).toBe("/invitations/AbC123"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("answers an account that does not exist with the not-found screen, after one read: a 404 is never retried", async () => {
    const { routes } = server();
    const spa = renderSpa(`${ACCOUNTS}/a-gone/edit`, routes);
    expect(await screen.findByRole("heading", { name: es.notFound.title })).toBeVisible();
    expect(count(spa.requests, "GET", /\/accounts\/a-gone$/)).toBe(1);
  });

  it("sends a visitor without a session from Settings to sign in, and back there afterwards", async () => {
    const { routes } = server();
    const spa = renderSpa("/settings?from=sp-household", {
      ...routes,
      "GET /api/v1/me": () => problemResponse(401, "Unauthenticated"),
    });
    expect(await screen.findByRole("heading", { name: es.auth.signIn.title })).toBeVisible();
    expect(spa.location()).toBe(`/sign-in?next=${encodeURIComponent("/settings?from=sp-household")}`);
  });
  it("tries a read the server failed (5xx) once more, as it may pass a moment later", async () => {
    const { routes } = server();
    let failures = 1;
    const spa = renderSpa("/spaces/sp-personal/categories", {
      ...routes,
      "GET /api/v1/spaces/{spaceId}/categories": (request, params) =>
        failures-- > 0
          ? problemResponse(503, "ServiceUnavailable")
          : routes["GET /api/v1/spaces/{spaceId}/categories"]!(request, params),
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: es.categories.title }, { timeout: 4_000 }),
    ).toBeVisible();
    expect(count(spa.requests, "GET", /\/categories$/)).toBe(2);
  });
});

describe("the accounts, categories and settings areas' copy (ruling P276)", () => {
  it("shows the accounts' own copy after a cold load, and in English after a language change", async () => {
    const missing = watchMissingMessages();
    const spa = renderSpa(ACCOUNTS, server().routes);
    expect(await screen.findByText(es.accounts.section.everyday, {}, { timeout: 5_000 })).toBeVisible();
    expect(loadedAreas(spa)).toEqual(["es:accounts"]);

    speak(spa, "en");
    expect(await screen.findByText(en.accounts.section.everyday)).toBeVisible();
    expect(loadedAreas(spa)).toEqual(["en:accounts", "es:accounts"]);
    expect(missing()).toEqual([]);
  });

  it("shows the categories' own copy after a cold load, and in English after a language change", async () => {
    const missing = watchMissingMessages();
    const spa = renderSpa("/spaces/sp-personal/categories", server().routes);
    // P292: the subtitle names the space, as board Categorías 01 does.
    const subtitle = (text: string) => text.replace("{space}", "Personal");
    expect(await screen.findByText(subtitle(es.categories.subtitle), {}, { timeout: 5_000 })).toBeVisible();
    expect(loadedAreas(spa)).toEqual(["es:categories"]);

    speak(spa, "en");
    expect(await screen.findByText(subtitle(en.categories.subtitle))).toBeVisible();
    expect(loadedAreas(spa)).toEqual(["en:categories", "es:categories"]);
    expect(missing()).toEqual([]);
  });

  it("shows Settings' own copy after a cold load, and in English after a language change", async () => {
    const missing = watchMissingMessages();
    const spa = renderSpa("/settings", server().routes);
    expect(await screen.findByText(es.settings.numbersAndDates, {}, { timeout: 5_000 })).toBeVisible();
    expect(loadedAreas(spa)).toEqual(["es:settings"]);

    speak(spa, "en");
    expect(await screen.findByText(en.settings.numbersAndDates)).toBeVisible();
    expect(loadedAreas(spa)).toEqual(["en:settings", "es:settings"]);
    expect(missing()).toEqual([]);
  });
});

describe("an account's own screen in the SPA (ruling P327, #315)", () => {
  const NOVEMBER = { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" };
  /** What an account's screen reads besides what Cuentas does: its movements and its breakdown, by `accountId`. */
  const accountReads = (routes: Record<string, FakeHandler>): Record<string, FakeHandler> => {
    const breakdown = {
      period: NOVEMBER,
      total: cop(2_000_000),
      account: { id: "a-bank", in: cop(3_200_000), out: cop(2_500_000), movedToOwnAccounts: cop(500_000) },
      groups: [
        {
          id: "g-home",
          key: "housing",
          name: "Vivienda",
          archived: false,
          total: cop(2_000_000),
          share: "100.00",
          movements: 1,
          categories: [
            {
              id: "c-rent",
              key: "rent",
              name: "Arriendo",
              archived: false,
              total: cop(2_000_000),
              share: "100.00",
              movements: 1,
              subcategories: [],
            },
          ],
        },
      ],
    };
    return {
      ...routes,
      "GET /api/v1/me/transactions": () =>
        jsonResponse({
          period: NOVEMBER,
          totals: { share: cop(0), income: cop(0) },
          items: [
            activityItemDto({
              transaction: transactionDto({
                id: "t-rent",
                description: "Arriendo noviembre",
                date: "2026-11-01",
                amount: cop(2_000_000),
                payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(2_000_000) }],
              }),
              you: { memberIds: ["m-ana"], share: cop(1_000_000), paid: cop(2_000_000) },
            }),
          ],
          nextCursor: null,
        }),
      "GET /api/v1/me/reports/spending-by-group": () => jsonResponse({ currency: "COP", ...breakdown }),
      "GET /api/v1/spaces/{spaceId}/reports/spending-by-group": (_, { spaceId }) =>
        jsonResponse({ spaceId, ...breakdown, account: { ...breakdown.account, id: "a-fund" } }),
      "GET /api/v1/spaces/{spaceId}/transactions": () =>
        jsonResponse({ ...octoberPage, period: NOVEMBER, items: [] }),
    };
  };
  const queryOf = (requests: Request[], path: RegExp) =>
    requests
      .filter((r) => r.method === "GET" && path.test(new URL(r.url).pathname))
      .map((r) => Object.fromEntries(new URL(r.url).searchParams));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-13T15:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens from its row in Cuentas on its movements across her spaces, then its statistics, and Configurar opens its edit form", async () => {
    const { routes } = server();
    const spa = renderSpa(ACCOUNTS, accountReads(routes));
    await userEvent.click(await screen.findByRole("link", { name: /^Bancolombia/ }, { timeout: 5_000 }));

    await waitFor(() => expect(spa.location()).toBe(`${ACCOUNTS}/a-bank`));
    expect(await screen.findByRole("heading", { level: 1, name: "Bancolombia" })).toBeVisible();
    expect(document.title).toBe("Bancolombia · Hearth");
    expect(normalized(screen.getByRole("region", { name: "Saldo de hoy" }).textContent)).toContain("$ 1.000");
    expect(await screen.findByText(/entró/)).toHaveTextContent(
      /entró\s\+\$\s3\.200\.000 · salió\s−\$\s2\.500\.000/,
    );
    expect(normalized(screen.getByRole("link", { name: /Arriendo noviembre/ }).textContent)).toBe(
      "Arriendo noviembreHogar · tu parte $ 1.000.000−$ 2.000.000",
    );
    // A personal account reads its movements across every space of hers, and its breakdown, by its id.
    expect(queryOf(spa.requests, /\/me\/transactions$/)).toContainEqual({ accountId: "a-bank", limit: "50" });
    // Every read of the breakdown is the account's: the personal one without it is never asked for here.
    const reports = queryOf(spa.requests, /\/me\/reports\/spending-by-group$/);
    expect(reports.length).toBeGreaterThan(0);
    expect(reports).toEqual(reports.map(() => ({ period: "2026-11", accountId: "a-bank" })));

    await userEvent.click(screen.getByRole("link", { name: "Estadísticas" }));
    await waitFor(() => expect(spa.location()).toBe(`${ACCOUNTS}/a-bank?view=stats`));
    expect(await screen.findByText("gastó", { exact: false })).toHaveTextContent(
      /gastó\s\$\s2\.000\.000 · movió\s\$\s500\.000 a tus cuentas/,
    );
    const groups = screen.getByRole("list", { name: "En qué se gastó" });
    expect(normalized(within(groups).getByRole("listitem").textContent)).toBe(
      "Vivienda100 % · Arriendo · 1 movimiento$ 2.000.000",
    );

    await userEvent.click(screen.getByRole("link", { name: "Configurar" }));
    await waitFor(() => expect(spa.location()).toBe(`${ACCOUNTS}/a-bank/edit`));
    expect(await screen.findByLabelText("Nombre")).toHaveValue("Bancolombia");
  });

  it("opens a shared fund's screen for a MEMBER, with the space's movements by the fund and no Configurar", async () => {
    const { routes, state } = server();
    state.spaces = [spaceDto(), householdSpace({ role: "MEMBER" })];
    state.accounts = [
      accountDto({ id: "a-fund", name: "Fondo de Hogar", type: "SHARED_FUND", balance: cop(2_070_000) }),
    ];
    const spa = renderSpa("/spaces/sp-household/accounts", accountReads(routes));
    await userEvent.click(await screen.findByRole("link", { name: /^Fondo de Hogar/ }, { timeout: 5_000 }));

    await waitFor(() => expect(spa.location()).toBe("/spaces/sp-household/accounts/a-fund"));
    expect(await screen.findByRole("heading", { level: 1, name: "Fondo de Hogar" })).toBeVisible();
    expect(await screen.findByText("No hay movimientos en este período.")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Configurar" })).toBeNull();
    expect(queryOf(spa.requests, /\/spaces\/sp-household\/transactions$/)).toContainEqual({
      accountId: "a-fund",
      limit: "50",
    });
    const reports = queryOf(spa.requests, /\/spaces\/sp-household\/reports\/spending-by-group$/);
    expect(reports.length).toBeGreaterThan(0);
    expect(reports).toEqual(reports.map(() => ({ period: "2026-11", accountId: "a-fund" })));
  });
});
