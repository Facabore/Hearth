import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, guestDto, memberDto, rowContext, transactionDto } from "../../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { writeTrail } from "@/shared/ui/navigation/history";
import type { MemberDto, TransactionDto } from "@/shared/ui/api/dto";
import type { TransactionDetail } from "./detail-loader";
import { TransactionSheet } from "./transaction-sheet";

const mocks = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
// Exposes what the sheet passes to the link, so a test can tell that the edit route is prefetched like any other.
vi.mock("next/link", () => ({
  default: ({ prefetch, children, ...props }: { prefetch?: boolean; children: ReactNode }) => (
    <a data-prefetch={String(prefetch)} {...props}>
      {children}
    </a>
  ),
}));
beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});

const norm = (text: string | null) => (text ?? "").replace(/\s/g, " ");
const ORIGIN = "/spaces/s-1/transactions";

const ana = { userId: "u-ana", role: "OWNER", memberId: null } as const;
const detailOf = (
  tx: TransactionDto,
  members: MemberDto[] = [],
  viewer: TransactionDetail["viewer"] = ana,
): TransactionDetail => ({ tx, problem: null, members, viewer });

const open = (detail: TransactionDetail, origin = ORIGIN, locale: "es" | "en" = "es") =>
  renderWithIntl(<TransactionSheet spaceId="s-1" detail={detail} context={rowContext} origin={origin} />, {
    locale,
  });

/** The text of the definition a term names, inside the sheet. */
const definition = (term: string) => {
  const pair = within(screen.getByRole("dialog")).getByText(term, { selector: "dt" }).parentElement!;
  return norm(pair.querySelector("dd")!.textContent);
};
const terms = () => [...screen.getByRole("dialog").querySelectorAll("dt")].map((dt) => norm(dt.textContent));
/** The sheet's description: the signed amount. */
const described = () => {
  const dialog = screen.getByRole("dialog");
  return norm(document.getElementById(dialog.getAttribute("aria-describedby")!)!.textContent);
};

const market = transactionDto({
  id: "t-1",
  type: "EXPENSE",
  description: "Market",
  amount: cop(85_000),
  date: "2026-10-31",
  occurredAt: "2026-10-31T17:30:00.000Z",
  timeZone: "America/Bogota",
  categoryId: "c-veg",
  payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(85_000) }],
});
const juan = memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" });
const anaMember = memberDto({ id: "m-ana", userId: "u-ana", displayName: "Ana" });

describe("transaction detail sheet (rulings P189, P190)", () => {
  it("shows a personal expense: type, amount, date and time, category path, account and description", async () => {
    open(detailOf(market));
    expect(screen.getByRole("dialog", { name: "Market" })).toBeInTheDocument();
    expect(described()).toBe("−$ 85.000");
    expect(definition("Tipo")).toBe("Gasto");
    expect(definition("Fecha y hora")).toBe("31/10/2026 · 12:30");
    expect(definition("Categoría")).toBe("Groceries › Vegetables");
    expect(definition("Cuenta")).toBe("Bancolombia");
    expect(definition("Descripción")).toBe("Market");
    expect(terms()).not.toContain("Pagó");
    expect(terms()).not.toContain("División");
    expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute(
      "href",
      "/spaces/s-1/transactions/t-1/edit?returnTo=%2Fspaces%2Fs-1%2Ftransactions",
    );
    expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute("data-prefetch", "undefined");
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeEnabled();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("signs an income with a plus and names its receiving account", () => {
    open(
      detailOf(
        transactionDto({
          id: "t-2",
          type: "INCOME",
          description: "Salary",
          amount: cop(3_200_000),
          categoryId: "c-salary",
          destinationAccountId: "a-bank",
        }),
      ),
    );
    expect(screen.getByRole("dialog", { name: "Salary" })).toBeInTheDocument();
    expect(described()).toBe("+$ 3.200.000");
    expect(definition("Cuenta que recibe")).toBe("Bancolombia");
    expect(definition("Categoría")).toBe("Wages");
  });

  it("shows who paid and each share of a shared expense, in the space's join order", async () => {
    const dinner = transactionDto({
      id: "t-3",
      type: "EXPENSE",
      description: "Dinner",
      amount: cop(300_000),
      date: "2026-10-12",
      createdBy: "u-juan",
      payments: [{ memberId: "m-juan", accountId: "a-juan", amount: cop(300_000) }],
      shares: [
        { memberId: "m-ana", amount: cop(150_000), splitMethod: "EQUAL" },
        { memberId: "m-juan", amount: cop(150_000), splitMethod: "EQUAL" },
      ],
    });
    open(detailOf(dinner, [anaMember, juan], { ...ana, memberId: "m-ana" }));
    expect(definition("Pagó")).toBe("Juan");
    expect(definition("Cuenta")).toBe("Cuenta de Juan");
    const shares = within(screen.getByRole("list", { name: "División" })).getAllByRole("listitem");
    expect(shares.map((item) => norm(item.textContent))).toEqual(["Ana (tú) $ 150.000", "Juan $ 150.000"]);
    expect(definition("División")).toContain("Iguales");
    expect(norm(screen.getByRole("dialog").textContent)).toContain(
      "Solo Juan puede editarlo, porque el dinero se mueve en su cuenta. Puedes eliminarlo.",
    );
    expect(screen.queryByRole("link", { name: "Editar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("names a guest's payment after the guest, with no account", () => {
    const taxi = transactionDto({
      description: "Taxi",
      amount: cop(20_000),
      payments: [{ memberId: "m-pedro", accountId: null, amount: cop(20_000) }],
      shares: [{ memberId: "m-ana", amount: cop(20_000), splitMethod: "EQUAL" }],
    });
    open(
      detailOf(taxi, [anaMember, guestDto({ id: "m-pedro", displayName: "Pedro" })], {
        ...ana,
        memberId: "m-ana",
      }),
    );
    expect(definition("Pagó")).toBe("Pedro (invitado)");
    expect(terms()).not.toContain("Cuenta");
  });

  it("names a fund that paid with no member", () => {
    const rent = transactionDto({
      description: "Rent",
      amount: cop(900_000),
      payments: [{ memberId: null, accountId: "a-visa", amount: cop(900_000) }],
      shares: [{ memberId: "m-ana", amount: cop(900_000), splitMethod: "EQUAL" }],
    });
    open(detailOf(rent, [anaMember, juan], { ...ana, memberId: "m-ana" }));
    expect(definition("Pagó")).toBe("Visa");
    expect(definition("Cuenta")).toBe("Visa");
  });

  it("reads an untimed row as Sin hora and a row from another zone with its city", () => {
    const { unmount } = open(detailOf({ ...market, occurredAt: null, timeZone: null }));
    expect(definition("Fecha y hora")).toBe("31/10/2026 · Sin hora");
    unmount();
    open(detailOf({ ...market, timeZone: "Europe/Madrid" }));
    expect(definition("Fecha y hora")).toBe("31/10/2026 · 18:30 · Madrid");
  });

  it("says Sin descripción when there is none and titles the sheet with the type", () => {
    open(detailOf({ ...market, description: "" }));
    expect(screen.getByRole("dialog", { name: "Gasto" })).toBeInTheDocument();
    expect(definition("Descripción")).toBe("Sin descripción");
  });

  it("shows a transfer's Desde and Hacia and no category", () => {
    open(
      detailOf(
        transactionDto({
          id: "t-4",
          type: "TRANSFER",
          description: "Card payment",
          amount: cop(500_000),
          sourceAccountId: "a-bank",
          destinationAccountId: "a-visa",
        }),
      ),
    );
    expect(definition("Desde")).toBe("Bancolombia");
    expect(definition("Hacia")).toBe("Visa");
    expect(described()).toBe("$ 500.000");
    expect(terms()).not.toContain("Categoría");
    expect(terms()).not.toContain("Cuenta");
  });

  it("shows a settlement's two members and why it is not edited", () => {
    const settlement = transactionDto({
      id: "t-5",
      type: "SETTLEMENT",
      description: "",
      amount: cop(50_000),
      payerMemberId: "m-juan",
      receivingMemberId: "m-ana",
    });
    open(detailOf(settlement, [anaMember, juan], { ...ana, memberId: "m-ana" }));
    expect(definition("Desde")).toBe("Juan");
    expect(definition("Hacia")).toBe("Ana (tú)");
    expect(norm(screen.getByRole("dialog").textContent)).toContain(
      "Un pago entre miembros no se edita: elimínalo y regístralo de nuevo desde Saldos.",
    );
    expect(screen.queryByRole("link", { name: "Editar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
  });

  it("offers no action to a viewer who may not change the transaction", () => {
    open(detailOf(market, [], { ...ana, role: "VIEWER" }));
    expect(screen.queryByRole("link", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Eliminar" })).toBeNull();
  });

  it("closes to the address it came from, without tx", async () => {
    open(detailOf(market), "/spaces/s-1/transactions?period=2026-10");
    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(mocks.router.replace).toHaveBeenCalledWith("/spaces/s-1/transactions?period=2026-10", {
      scroll: false,
    });
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("keeps the list's filter in the Editar link's return address", () => {
    open(detailOf(market), "/spaces/s-1/transactions?period=2026-10&category=c-1");
    expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute(
      "href",
      "/spaces/s-1/transactions/t-1/edit?returnTo=" +
        encodeURIComponent("/spaces/s-1/transactions?period=2026-10&category=c-1"),
    );
  });

  describe("closing after an in-app open goes back, so the list is not in history twice", () => {
    const list = "/spaces/s-1/transactions?period=2026-10";
    const opened = `${list}&tx=t-1`;
    const arrive = (urls: string[]) => {
      window.history.replaceState({}, "", urls.at(-1));
      writeTrail({ urls, pos: urls.length - 1 });
    };

    it("goes back with the close button when the entry before is the list without tx", async () => {
      arrive([list, opened]);
      open(detailOf(market), list);
      await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
      expect(mocks.router.back).toHaveBeenCalledTimes(1);
      expect(mocks.router.replace).not.toHaveBeenCalled();
    });

    it("goes back with Escape too", async () => {
      arrive([list, opened]);
      open(detailOf(market), list);
      await userEvent.keyboard("{Escape}");
      expect(mocks.router.back).toHaveBeenCalledTimes(1);
      expect(mocks.router.replace).not.toHaveBeenCalled();
    });

    it("replaces on a deep link or a reload with no entry before it", async () => {
      arrive([opened]);
      open(detailOf(market), list);
      await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
      expect(mocks.router.replace).toHaveBeenCalledWith(list, { scroll: false });
      expect(mocks.router.back).not.toHaveBeenCalled();
    });

    it("replaces when the entry before is another list, not the origin", async () => {
      arrive(["/spaces/s-1/transactions?period=2026-09", opened]);
      open(detailOf(market), list);
      await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
      expect(mocks.router.replace).toHaveBeenCalledWith(list, { scroll: false });
      expect(mocks.router.back).not.toHaveBeenCalled();
    });

    it("replaces when the trail does not stand on the address (a stale trail)", async () => {
      writeTrail({ urls: [list, opened], pos: 1 });
      window.history.replaceState({}, "", `${list}&tx=other`);
      open(detailOf(market), list);
      await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
      expect(mocks.router.replace).toHaveBeenCalledWith(list, { scroll: false });
      expect(mocks.router.back).not.toHaveBeenCalled();
    });
  });

  it("closes with Escape the same way", async () => {
    open(detailOf(market));
    await userEvent.keyboard("{Escape}");
    expect(mocks.router.replace).toHaveBeenCalledWith(ORIGIN, { scroll: false });
    expect(mocks.router.push).not.toHaveBeenCalled();
  });

  it("shows TransactionNotFound inside the sheet when the transaction is gone", async () => {
    open({
      tx: null,
      problem: { code: "TransactionNotFound", status: 404, requestId: null, errors: [], field: null },
      members: [],
      viewer: ana,
    });
    const dialog = screen.getByRole("dialog", { name: "No encontramos ese movimiento." });
    expect(within(dialog).getByRole("alert")).toHaveTextContent("No encontramos ese movimiento.");
    expect(within(dialog).queryByRole("link")).toBeNull();
    expect(dialog.querySelector("dt")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("is also English", () => {
    open(detailOf(market), ORIGIN, "en");
    expect(definition("Date and time")).toBe("31/10/2026 · 12:30");
    expect(screen.getByRole("link", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});
