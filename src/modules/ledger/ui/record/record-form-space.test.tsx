import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountDto,
  categoryDto,
  groupDto,
  householdSpace,
  spaceDto,
} from "../../../../../tests/support/ui/dto";
import { fakeApi } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import type { RecordInitial } from "../edit/edit-initial";
import { handOver, heldFor, release } from "./record-carry";
import { RecordForm, type RecordFormProps } from "./record-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T04:30:00Z"));
});
afterEach(() => vi.useRealTimers());

const groups = [
  groupDto({
    id: "g-food",
    name: "Food",
    categories: [categoryDto({ id: "c-groceries", name: "Groceries" })],
  }),
];
const accounts = [accountDto({ id: "a-bank", name: "Bancolombia" })];
const trip = spaceDto({ id: "sp-trip", name: "Viaje", kind: "DIRECT", role: "OWNER" });

const show = (props: Partial<RecordFormProps> = {}, locale?: "en") =>
  renderWithIntl(
    <RecordForm
      space={spaceDto()}
      accounts={accounts}
      groups={groups}
      formats={BUILT_IN_FORMATS}
      initialKind="EXPENSE"
      initialNow="2026-11-01T04:30:00.000Z"
      timeZone="America/Bogota"
      people={[]}
      api={fakeApi({}).api}
      {...props}
    />,
    locale ? { locale } : undefined,
  );

/** The owner, 2026-11-06: "si le doy a registrar no me ate únicamente a el espacio en el que le dí" (ruling P305). */
describe("the record form's space can change (ruling P305)", () => {
  it("opens the spaces the person records in and hands the chosen one the typed amount, description and kind", async () => {
    show({ spaces: [spaceDto(), householdSpace(), trip], returnTo: "/spaces/sp-personal/transactions" });
    await userEvent.type(screen.getByLabelText("Monto"), "25000");
    await userEvent.type(screen.getByLabelText("Descripción"), "Farmacia");
    await userEvent.click(screen.getByRole("button", { name: "Espacio: Personal. Cambiar" }));
    const sheet = await screen.findByRole("dialog", { name: "¿En qué espacio lo registras?" });
    // The current space is marked; the others are choices.
    expect(within(sheet).getByRole("button", { name: /Personal/ })).toHaveAttribute("aria-current", "true");
    await userEvent.click(within(sheet).getByRole("button", { name: /Household/ }));
    // A replace that keeps where the form was opened from; what was typed waits in memory, never in the address.
    expect(router.replace).toHaveBeenCalledWith(
      `/spaces/sp-household/new?returnTo=${encodeURIComponent("/spaces/sp-personal/transactions")}`,
    );
    expect(heldFor("sp-household")).toEqual({
      kind: "EXPENSE",
      amount: "25.000",
      description: "Farmacia",
      when: null,
    });
    release();
  });

  it("keeps an income an income in the space it moves to", async () => {
    show({ spaces: [spaceDto(), householdSpace()], initialKind: "INCOME" });
    await userEvent.click(screen.getByRole("button", { name: "Espacio: Personal. Cambiar" }));
    const sheet = await screen.findByRole("dialog", { name: "¿En qué espacio lo registras?" });
    await userEvent.click(within(sheet).getByRole("button", { name: /Household/ }));
    expect(router.replace).toHaveBeenCalledWith("/spaces/sp-household/new?type=income");
    expect(heldFor("sp-household")?.kind).toBe("INCOME");
    release();
  });

  it("drops a draft whose move never arrived, so the next form starts empty", () => {
    handOver("sp-household", { kind: "EXPENSE", amount: "25.000", description: "Farmacia", when: null });
    // The person ended up on another space's form instead.
    show({ space: spaceDto() });
    expect(heldFor("sp-household")).toBeNull();
  });

  it("starts from what another space's form handed over, and still asks before that draft is lost", async () => {
    const hold = vi.fn(() => () => undefined);
    handOver("sp-household", { kind: "EXPENSE", amount: "25.000", description: "Farmacia", when: null });
    show({ space: householdSpace(), holdNavigation: hold });
    expect(screen.getByLabelText("Monto")).toHaveValue("25.000");
    expect(screen.getByLabelText("Descripción")).toHaveValue("Farmacia");
    // Leaving asks while something is typed, even if this form only received it.
    expect(hold).toHaveBeenCalled();
    // Once on screen it is the form's own: the next visit to the space starts empty.
    expect(heldFor("sp-household")).toBeNull();
  });

  it("keeps the space a plain value with one space to record in, and while editing", () => {
    const { unmount } = show({ spaces: [spaceDto()] });
    expect(screen.queryByRole("button", { name: /^Espacio:/ })).toBeNull();
    // A value that cannot change never announces "Cambiar".
    expect(screen.queryByLabelText(/Cambiar/, { selector: "span" })).toBeNull();
    unmount();
    const initial: RecordInitial = {
      kind: "EXPENSE",
      amount: "85.000",
      description: "Market",
      category: { categoryId: "c-groceries", subcategoryId: null },
      accountId: "a-bank",
      toAccountId: null,
      when: { date: "2026-10-20", wall: { hour: 12, minute: 30 } },
      split: null,
    };
    show({
      spaces: [spaceDto(), householdSpace()],
      edit: { initial, backHref: "/spaces/sp-personal/transactions?tx=t-1", onSave: vi.fn(async () => null) },
    });
    expect(screen.queryByRole("button", { name: /^Espacio:/ })).toBeNull();
  });

  it("speaks English too", async () => {
    show({ spaces: [spaceDto(), householdSpace()] }, "en");
    await userEvent.click(screen.getByRole("button", { name: "Space: Personal. Change" }));
    expect(
      await screen.findByRole("dialog", { name: "Which space do you record it in?" }),
    ).toBeInTheDocument();
  });
});
