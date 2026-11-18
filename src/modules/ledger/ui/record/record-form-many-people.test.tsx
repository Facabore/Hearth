import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import {
  accountDto,
  categoryDto,
  groupDto,
  spaceDto,
  transactionDto,
} from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import type { Api } from "@/shared/ui/api/client";
import type { Person } from "../direct/counterparts";
import { RecordForm } from "./record-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T15:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const groceries = categoryDto({ id: "c-groceries", name: "Groceries", key: "groceries", subcategories: [] });
const groups = [groupDto({ id: "g-food", name: "Food", categories: [groceries] })];
const accounts = [accountDto({ id: "a-bank", name: "Bancolombia", type: "BANK" })];
const friend = (
  id: string,
  name: string,
  lastMovement: string | null,
  extra: Partial<Person> = {},
): Person => ({
  memberId: id,
  name,
  isGuest: false,
  directSpace: `Ana & ${name}`,
  places: [],
  lastMovement,
  ...extra,
});
/** Eight friends, as P340's board has more than fit: the newest movements are Juan's, Ana's and Mamá's. */
const PEOPLE: Person[] = [
  friend("m-dad", "Papá", "2026-09-01"),
  friend("m-juan", "Juan", "2026-11-15", { handle: "juanp" }),
  friend("m-bro", "Brother", "2026-10-01", { handle: "brother" }),
  friend("m-bro-g1", "Brother", "2026-11-03", { isGuest: true }),
  friend("m-bro-g2", "Brother", "2026-09-12", { isGuest: true }),
  friend("m-ana", "Ana", "2026-11-16", { nickname: "Anita" }),
  friend("m-mama", "Mamá", "2026-11-10"),
  friend("m-sam", "Sam", null),
];
const form = (api: Api) =>
  renderWithIntl(
    <RecordForm
      space={spaceDto()}
      accounts={accounts}
      groups={groups}
      formats={BUILT_IN_FORMATS}
      initialKind="EXPENSE"
      initialNow="2026-11-17T15:00:00.000Z"
      timeZone="America/Bogota"
      people={PEOPLE}
      api={api}
    />,
  );
const openWho = async () => {
  await userEvent.click(screen.getByRole("button", { name: /Quién pagó y para quién/ }));
  return screen.findByRole("dialog", { name: "¿Quién pagó y para quién?" });
};
const forWhom = (sheet: HTMLElement) => within(sheet).getByRole("list", { name: "Para quién fue" });
const listed = (sheet: HTMLElement) =>
  within(forWhom(sheet))
    .getAllByRole("checkbox")
    .map((box) => document.getElementById(box.closest("li")!.getAttribute("aria-labelledby")!)!.textContent);
const search = (sheet: HTMLElement) =>
  within(sheet).getByRole("searchbox", { name: "Buscar o agregar a alguien" });
const payers = (sheet: HTMLElement) =>
  within(within(sheet).getByRole("radiogroup", { name: "Pagó" }))
    .getAllByRole("radio")
    .map((radio) => radio.textContent);
const created = (spaceId: string, made = false) =>
  jsonResponse({ spaceId, created: made, expense: { ...transactionDto({ id: "t-1" }), warnings: [] } }, 201);

describe("Para quién fue with many friends: recent people and a search (P340)", () => {
  it("shows Tú, whoever is ticked and the three most recent, then the search and its note (S2)", async () => {
    const { api } = fakeApi({});
    form(api);
    const sheet = await openWho();
    expect(listed(sheet)).toEqual(["Tú", "Ana", "Juan", "Mamá"]);
    await userEvent.click(within(sheet).getByRole("checkbox", { name: /^Mamá/ }));
    expect(listed(sheet)).toEqual(["Tú", "Mamá", "Ana", "Juan", "Brother (invitado)"]);
    expect(search(sheet)).toBeVisible();
    expect(
      within(sheet).getByText(
        "Ves a quienes registraste hace poco. Busca entre tus 8 amigos por nombre, apodo o @.",
      ),
    ).toBeVisible();
    expect(within(sheet).queryByRole("button", { name: "Agregar a alguien" })).not.toBeInTheDocument();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("finds everyone by name, apodo or @, ignoring case and accents, and tells same-name guests apart (S3)", async () => {
    const { api } = fakeApi({});
    form(api);
    const sheet = await openWho();
    await userEvent.type(search(sheet), "bro");
    expect(listed(sheet)).toEqual(["Brother", "Brother (invitado)", "Brother (invitado)"]);
    const lines = within(forWhom(sheet))
      .getAllByRole("checkbox")
      .map((box) => document.getElementById(box.getAttribute("aria-describedby")!)!.textContent);
    expect(lines).toEqual([
      "@brother",
      "Invitado · último movimiento 3/11/2026",
      "Invitado · último movimiento 12/9/2026",
    ]);
    await userEvent.clear(search(sheet));
    await userEvent.type(search(sheet), "ANITA");
    expect(listed(sheet)).toEqual(["Ana"]);
    await userEvent.clear(search(sheet));
    await userEvent.type(search(sheet), "@juanp");
    expect(listed(sheet)).toEqual(["Juan"]);
    await userEvent.clear(search(sheet));
    await userEvent.type(search(sheet), "mama");
    expect(listed(sheet)).toEqual(["Mamá"]);
  });

  it("keeps whoever is ticked while searching, and says so (S5)", async () => {
    const { api } = fakeApi({});
    form(api);
    const sheet = await openWho();
    await userEvent.click(within(sheet).getByRole("checkbox", { name: /^Juan/ }));
    await userEvent.click(within(sheet).getByRole("checkbox", { name: /^Ana/ }));
    await userEvent.type(search(sheet), "sam");
    await userEvent.click(within(sheet).getByRole("checkbox", { name: /^Sam/ }));
    expect(within(sheet).getByText("Ya marcaste a Juan y Ana.")).toBeVisible();
    await userEvent.clear(search(sheet));
    expect(listed(sheet)).toEqual(["Tú", "Juan", "Ana", "Sam", "Mamá", "Brother (invitado)", "Brother"]);
    for (const name of ["Juan", "Ana", "Sam"])
      expect(within(sheet).getByRole("checkbox", { name: new RegExp(`^${name}`) })).toBeChecked();
  });

  it("creates a guest only from Agregar «…» como invitado, ticked, and sends it (S4)", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/direct-splits": () => created("sp-new", true) });
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "50000");
    await userEvent.click(screen.getByRole("button", { name: "Elegir categoría" }));
    await userEvent.click(await screen.findByRole("radio", { name: "Groceries" }));
    const sheet = await openWho();
    await userEvent.click(within(sheet).getByRole("checkbox", { name: /^Tú/ }));
    await userEvent.type(search(sheet), "Marta");
    expect(within(forWhom(sheet)).queryAllByRole("checkbox")).toEqual([]);
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar «Marta» como invitado" }));
    expect(search(sheet)).toHaveValue("");
    expect(within(sheet).getByRole("checkbox", { name: /^Marta/ })).toBeChecked();
    await userEvent.click(within(sheet).getByRole("button", { name: "Listo" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(await requests[0]!.json()).toMatchObject({ counterpart: { kind: "GUEST", displayName: "Marta" } });
  });
});

describe("Pagó with many friends: recent people and Otra persona (P340)", () => {
  it("offers Tú, the two most recent and Otra persona, whose search picks who paid (S1)", async () => {
    const { api } = fakeApi({});
    form(api);
    const sheet = await openWho();
    expect(payers(sheet)).toEqual(["Tú", "Ana", "Juan"]);
    await userEvent.click(within(sheet).getByRole("button", { name: "Otra persona" }));
    const find = within(sheet).getByRole("searchbox", { name: "Buscar quién pagó" });
    await userEvent.type(find, "papa");
    await userEvent.click(within(sheet).getByRole("button", { name: /^Papá/ }));
    expect(payers(sheet)).toEqual(["Tú", "Papá", "Ana", "Juan"]);
    expect(within(sheet).getByRole("radio", { name: "Papá" })).toBeChecked();
    expect(
      within(sheet).getByText("Papá lo pagó con su plata: no se mueve ninguna de tus cuentas."),
    ).toBeVisible();
    expect(within(sheet).queryByRole("searchbox", { name: "Buscar quién pagó" })).not.toBeInTheDocument();
  });

  it("adds someone without Hearth who paid from Otra persona's search", async () => {
    const { api } = fakeApi({});
    form(api);
    const sheet = await openWho();
    await userEvent.click(within(sheet).getByRole("button", { name: "Otra persona" }));
    await userEvent.type(within(sheet).getByRole("searchbox", { name: "Buscar quién pagó" }), "Marta");
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar «Marta» como invitado" }));
    expect(within(sheet).getByRole("radio", { name: "Marta (invitado)" })).toBeChecked();
  });
});
