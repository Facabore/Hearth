import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import es from "@/i18n/messages/es.json";
import type { AccountDto, CategoryGroupDto, MeDto, SpaceDto } from "@/shared/ui/api/dto";
import {
  accountDto,
  categoryDto,
  cop,
  groupDto,
  householdSpace,
  meDto,
  octoberPage,
  patchedMe,
  spaceDto,
} from "../../tests/support/ui/dto";
import { jsonResponse, type FakeHandler } from "../../tests/support/ui/fake-api";
import { renderSpa } from "../../tests/support/ui/spa";

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
      const { name } = (await request.json()) as { name: string };
      const created = householdSpace({ id: "sp-new", name });
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
    "GET /api/v1/spaces/{spaceId}/accounts/{accountId}": (_, { accountId }) =>
      jsonResponse(state.accounts.find((account) => account.id === accountId)),
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
    expect(await screen.findByRole("heading", { level: 1, name: es.accounts.title })).toBeVisible();
    expect(screen.getByText("Nequi")).toBeInTheDocument();
    expect(document.title).toBe(`${es.accounts.title} · Hearth`);

    await spa.router.navigate({ href: `${ACCOUNTS}/new` });
    await userEvent.click(await screen.findByRole("radio", { name: "Efectivo" }));
    await userEvent.type(screen.getByLabelText("Nombre"), "Caja");
    await userEvent.type(screen.getByLabelText("Saldo inicial"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));

    await waitFor(() => expect(spa.location()).toBe(ACCOUNTS));
    expect(await screen.findByText("Caja")).toBeInTheDocument();
  });

  it("hides an account from a confirmation deep inside the list, through the app's own client", async () => {
    const { routes } = server();
    const spa = renderSpa(ACCOUNTS, routes);
    await userEvent.click(await screen.findByRole("button", { name: "Ocultar Nequi" }));
    const sheet = screen.getByRole("dialog", { name: "¿Ocultar Nequi?" });
    const before = untouched(spa.requests, [/\/accounts$/]);
    await userEvent.click(within(sheet).getByRole("button", { name: "Ocultar" }));

    // The archive went through the app's fake API, and the list moved it to its archived section.
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
    // N3: the shell is the space the person came from.
    expect(
      await screen.findByRole("button", { name: es.shell.space.current.replace("{name}", "Household") }),
    ).toBeVisible();
    const profile = count(spa.requests, "GET", /\/me$/);

    await userEvent.click(screen.getByRole("radio", { name: "1,234,567.89" }));
    await waitFor(() => expect(count(spa.requests, "PATCH", /\/me$/)).toBe(1));
    await spa.router.navigate({ href: "/spaces/sp-personal/transactions" });

    expect(await screen.findByText(/245,000/)).toBeInTheDocument();
    expect(count(spa.requests, "GET", /\/me$/)).toBe(profile);
  });

  it("renames the space in Settings and the shell shows the new name at once", async () => {
    const { routes } = server();
    renderSpa("/settings", routes);
    const field = await screen.findByLabelText("Nombre del espacio");
    await userEvent.clear(field);
    await userEvent.type(field, "Mis finanzas");
    await userEvent.tab();

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
});
