import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountDto,
  categoryDto,
  groupDto,
  spaceDto,
  transactionDto,
} from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, type FakeHandler } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { RecordForm } from "./record-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T04:30:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

const veg = categoryDto({ id: "c-veg", name: "Vegetables", parentCategoryId: "c-groceries" });
const fruit = categoryDto({ id: "c-fruit", name: "Fruit", parentCategoryId: "c-groceries" });
const groceries = categoryDto({ id: "c-groceries", name: "Groceries", subcategories: [veg, fruit] });
const dining = categoryDto({ id: "c-dining", name: "Dining" });
const groups = [groupDto({ id: "g-food", name: "Food", categories: [groceries, dining] })];
const accounts = [accountDto({ id: "a-bank", name: "Bancolombia" })];

const form = (routes: Record<string, FakeHandler> = {}, space: SpaceDto = spaceDto()) => {
  const fake = fakeApi({
    "POST /api/v1/spaces/{spaceId}/expenses": () => jsonResponse(transactionDto({ id: "t-new" }), 201),
    ...routes,
  });
  renderWithIntl(
    <RecordForm
      space={space}
      accounts={accounts}
      groups={groups}
      formats={BUILT_IN_FORMATS}
      initialKind="EXPENSE"
      initialNow="2026-11-01T04:30:00.000Z"
      timeZone="America/Bogota"
      api={fake.api}
    />,
  );
  return fake;
};

const chips = () => screen.getByRole("group", { name: "Categoría" });
// P348: a new expense starts on no account, so its first category opens "¿Quién pagó y para quién?" for the person to
// pick the account they paid from.
const chooseFirst = async (name: string) => {
  await userEvent.click(within(chips()).getByRole("button", { name }));
  const sheet = await screen.findByRole("dialog", { name: "¿Quién pagó y para quién?" });
  await userEvent.click(
    within(within(sheet).getByRole("radiogroup", { name: "Desde" })).getByRole("radio", {
      name: "Bancolombia",
    }),
  );
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
};
const subs = (name = "Groceries") => screen.getByRole("group", { name: `Subcategorías de ${name}` });
const save = async (requests: Request[]) => {
  await userEvent.type(screen.getByLabelText("Monto"), "85000");
  await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
  await waitFor(() => expect(requests.some((r) => r.url.endsWith("/expenses"))).toBe(true));
  return requests.find((r) => r.url.endsWith("/expenses"))!.json();
};

describe("a category chip chooses the category alone (P346, S3)", () => {
  it("leaves the subcategory used with it last unchosen, and records the category itself", async () => {
    localStorage.setItem(
      `hearth.recentCategories.${spaceDto().id}.EXPENSE`,
      JSON.stringify([{ categoryId: "c-groceries", subcategoryId: "c-veg" }]),
    );
    const { requests } = form();
    await chooseFirst("Groceries");
    expect(within(chips()).getByRole("button", { name: "Groceries" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(subs()).getByRole("button", { name: "Vegetables" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(within(subs()).getByRole("button", { name: "Sin subcategoría" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await save(requests)).toMatchObject({ categoryId: "c-groceries" });
  });
});

describe("the subcategory row starts with «Sin subcategoría» (P346, S4)", () => {
  it("checks it while none is chosen, chooses a subcategory on a tap, and clears it from «Sin subcategoría»", async () => {
    const { requests } = form();
    await chooseFirst("Groceries");
    const row = within(subs()).getAllByRole("button");
    expect(row.map((chip) => chip.textContent)).toEqual(["Sin subcategoría", "Vegetables", "Fruit"]);
    const none = row[0]!;
    expect(none).toHaveAttribute("aria-pressed", "true");
    expect(none.querySelector("svg")).not.toBeNull();
    expect(none).toHaveClass("min-h-11");

    await userEvent.click(within(subs()).getByRole("button", { name: "Fruit" }));
    expect(within(subs()).getByRole("button", { name: "Fruit" })).toHaveAttribute("aria-pressed", "true");
    expect(within(subs()).getByRole("button", { name: "Fruit" }).querySelector("svg")).not.toBeNull();
    expect(none).toHaveAttribute("aria-pressed", "false");
    expect(none.querySelector("svg")).toBeNull();

    await userEvent.click(none);
    expect(none).toHaveAttribute("aria-pressed", "true");
    expect(within(subs()).getByRole("button", { name: "Fruit" })).toHaveAttribute("aria-pressed", "false");

    // As before P346, a second tap on the chosen subcategory leaves the category without one.
    await userEvent.click(within(subs()).getByRole("button", { name: "Vegetables" }));
    await userEvent.click(within(subs()).getByRole("button", { name: "Vegetables" }));
    expect(none).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(within(subs()).getByRole("button", { name: "Vegetables" }));
    expect(await save(requests)).toMatchObject({ categoryId: "c-veg" });
  });

  it("draws no row for a category with no subcategories", async () => {
    form();
    await userEvent.click(within(chips()).getByRole("button", { name: "Dining" }));
    expect(screen.queryByRole("group", { name: "Subcategorías de Dining" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sin subcategoría" })).toBeNull();
  });
});

describe("another tap on the chosen chip still opens «Categoría» (P346, S5)", () => {
  it("opens the picker, with no double tap anywhere (S7)", async () => {
    form();
    await chooseFirst("Groceries");
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(within(chips()).getByRole("button", { name: "Groceries" }));
    expect(await screen.findByRole("dialog", { name: "Categoría" })).toBeInTheDocument();
  });
});

describe("the pencil edits the chosen category (P346, S6)", () => {
  const pencil = (name = "Groceries") => screen.queryByRole("button", { name: `Editar ${name}` });

  it("sits right after the chosen chip, a 44 px target, only once a category is chosen", async () => {
    form();
    expect(pencil()).toBeNull();
    await chooseFirst("Groceries");
    const button = pencil()!;
    expect(within(chips()).getByRole("button", { name: "Groceries" }).nextElementSibling).toBe(button);
    expect(button).toHaveClass("size-11", "rounded-full", "border", "border-line", "bg-surface");
    await userEvent.click(within(chips()).getByRole("button", { name: "Dining" }));
    expect(pencil()).toBeNull();
    expect(within(chips()).getByRole("button", { name: "Dining" }).nextElementSibling).toBe(pencil("Dining"));
  });

  it("shows no pencil to someone who only records in the space", async () => {
    form({}, spaceDto({ role: "MEMBER" }));
    await chooseFirst("Groceries");
    expect(within(chips()).getByRole("button", { name: "Groceries" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(pencil()).toBeNull();
  });

  it("opens «Editar categoría», and a save renames the chip and the subcategory row from the API's answer", async () => {
    const { requests } = form({
      "PATCH /api/v1/spaces/{spaceId}/categories/{categoryId}": async (request) =>
        jsonResponse({ ...groceries, ...(await request.clone().json()), subcategories: undefined }),
      "POST /api/v1/spaces/{spaceId}/categories": async (request) => {
        const body = await request.clone().json();
        return jsonResponse(
          categoryDto({ id: "c-bread", name: body.name, parentCategoryId: "c-groceries" }),
          201,
        );
      },
    });
    await chooseFirst("Groceries");
    await userEvent.click(within(subs()).getByRole("button", { name: "Fruit" }));
    await userEvent.click(pencil()!);
    const sheet = await screen.findByRole("dialog", { name: "Editar categoría" });
    // A new subcategory lands in the form's row at once, under the sheet.
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar" }));
    await userEvent.type(within(sheet).getByLabelText("Nueva subcategoría"), "Bread");
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar subcategoría" }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("group", { name: "Subcategorías de Groceries", hidden: true })).getByRole(
          "button",
          { name: "Bread", hidden: true },
        ),
      ).toBeInTheDocument(),
    );
    const name = within(sheet).getByLabelText("Nombre");
    await userEvent.clear(name);
    await userEvent.type(name, "Market");
    await userEvent.click(within(sheet).getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const patch = requests.find((r) => r.method === "PATCH")!;
    expect(new URL(patch.url).pathname).toBe(`/api/v1/spaces/${spaceDto().id}/categories/c-groceries`);
    expect(await patch.clone().json()).toEqual({ name: "Market" });
    expect(within(chips()).getByRole("button", { name: "Market" })).toHaveAttribute("aria-pressed", "true");
    expect(
      within(subs("Market"))
        .getAllByRole("button")
        .map((chip) => chip.textContent),
    ).toEqual(["Sin subcategoría", "Vegetables", "Fruit", "Bread"]);
    // The subcategory chosen before the edit is still the one recorded.
    expect(within(subs("Market")).getByRole("button", { name: "Fruit" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await save(requests)).toMatchObject({ categoryId: "c-fruit" });
  });

  it("clears the form's category when the sheet archives it", async () => {
    form({
      "POST /api/v1/spaces/{spaceId}/categories/{categoryId}/archive": () =>
        jsonResponse({ ...groceries, archivedAt: "2026-11-01T04:30:00Z", subcategories: undefined }),
    });
    await chooseFirst("Groceries");
    await userEvent.click(pencil()!);
    const sheet = await screen.findByRole("dialog", { name: "Editar categoría" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Archivar" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Archivar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(chips()).queryByRole("button", { name: "Groceries" })).toBeNull();
    expect(within(chips()).queryByRole("button", { pressed: true })).toBeNull();
    expect(screen.queryByRole("group", { name: /^Subcategorías de/ })).toBeNull();
    expect(pencil()).toBeNull();
  });

  it("clears the form's category when the sheet deletes it", async () => {
    form({
      "DELETE /api/v1/spaces/{spaceId}/categories/{categoryId}": () => new Response(null, { status: 204 }),
    });
    await chooseFirst("Groceries");
    await userEvent.click(pencil()!);
    const sheet = await screen.findByRole("dialog", { name: "Editar categoría" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Eliminar" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(chips()).queryByRole("button", { name: "Groceries" })).toBeNull();
    expect(within(chips()).queryByRole("button", { pressed: true })).toBeNull();
    expect(pencil()).toBeNull();
  });

  it("opens again from the pencil after a subcategory reached in the sheet is archived", async () => {
    form({
      "POST /api/v1/spaces/{spaceId}/categories/{categoryId}/archive": () =>
        jsonResponse({ ...fruit, archivedAt: "2026-11-01T04:30:00Z" }),
    });
    await chooseFirst("Groceries");
    await userEvent.click(pencil()!);
    const sheet = await screen.findByRole("dialog", { name: "Editar categoría" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Editar Fruit" }));
    const sub = await screen.findByRole("dialog", { name: "Editar categoría" });
    expect(within(sub).getByLabelText("Nombre")).toHaveValue("Fruit");
    await userEvent.click(within(sub).getByRole("button", { name: "Archivar" }));
    await userEvent.click(within(sub).getByRole("button", { name: "Archivar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(subs()).queryByRole("button", { name: "Fruit" })).toBeNull();

    await userEvent.click(pencil()!);
    const again = await screen.findByRole("dialog", { name: "Editar categoría" });
    expect(within(again).getByLabelText("Nombre")).toHaveValue("Groceries");
  });

  it("opens again from the pencil after a fresh read drops the subcategory the sheet was on", async () => {
    const props = {
      space: spaceDto(),
      accounts,
      formats: BUILT_IN_FORMATS,
      initialKind: "EXPENSE" as const,
      initialNow: "2026-11-01T04:30:00.000Z",
      timeZone: "America/Bogota",
      api: fakeApi({}).api,
    };
    const { rerender } = renderWithIntl(<RecordForm {...props} groups={groups} />);
    await chooseFirst("Groceries");
    await userEvent.click(pencil()!);
    const sheet = await screen.findByRole("dialog", { name: "Editar categoría" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Editar Fruit" }));
    expect(
      within(await screen.findByRole("dialog", { name: "Editar categoría" })).getByLabelText("Nombre"),
    ).toHaveValue("Fruit");

    // Another device archived Fruit: the route's next read no longer holds it, so its sheet has nothing to edit.
    rerender(
      <RecordForm
        {...props}
        groups={[
          groupDto({
            id: "g-food",
            name: "Food",
            categories: [{ ...groceries, subcategories: [veg] }, dining],
          }),
        ]}
      />,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await userEvent.click(pencil()!);
    const again = await screen.findByRole("dialog", { name: "Editar categoría" });
    expect(within(again).getByLabelText("Nombre")).toHaveValue("Groceries");
  });

  it("leaves the category without a subcategory when the chosen one is deleted from the sheet", async () => {
    const { requests } = form({
      "DELETE /api/v1/spaces/{spaceId}/categories/{categoryId}": () => new Response(null, { status: 204 }),
    });
    await chooseFirst("Groceries");
    await userEvent.click(within(subs()).getByRole("button", { name: "Fruit" }));
    await userEvent.click(pencil()!);
    const sheet = await screen.findByRole("dialog", { name: "Editar categoría" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Editar Fruit" }));
    const sub = await screen.findByRole("dialog", { name: "Editar categoría" });
    expect(within(sub).getByLabelText("Nombre")).toHaveValue("Fruit");
    await userEvent.click(within(sub).getByRole("button", { name: "Eliminar" }));
    await userEvent.click(within(sub).getByRole("button", { name: "Eliminar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(new URL(requests.find((r) => r.method === "DELETE")!.url).pathname).toBe(
      `/api/v1/spaces/${spaceDto().id}/categories/c-fruit`,
    );
    expect(within(chips()).getByRole("button", { name: "Groceries" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(subs()).queryByRole("button", { name: "Fruit" })).toBeNull();
    expect(within(subs()).getByRole("button", { name: "Sin subcategoría" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const body = await save(requests);
    expect(body).toMatchObject({ categoryId: "c-groceries" });
    expect(body).not.toHaveProperty("subcategoryId");
  });
});
