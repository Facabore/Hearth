import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, guestDto, memberDto, rowContext, transactionDto } from "../../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { writeTrail } from "@/shared/ui/navigation/history";
import type { MemberDto, TransactionDto } from "@/shared/ui/api/dto";
import type { TransactionDetail } from "./transaction-detail";
import { TransactionSheet } from "./transaction-sheet";
import { kindOf } from "../movement-kind";

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
): TransactionDetail => ({ tx, problem: null, members, viewer, ownAccountNames: {} });

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
    expect(described()).toBe("−\u206085.000 COP");
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

  it("names a contribution to the fund as one, like its row, untitled or not (issue #223)", () => {
    open(
      detailOf(
        transactionDto({
          id: "t-3",
          type: "TRANSFER",
          description: "",
          categoryId: null,
          payerMemberId: "m-ana",
          sourceAccountId: "a-bank",
          destinationAccountId: "a-visa",
          payments: [],
          shares: [],
        }),
      ),
    );
    expect(screen.getByRole("dialog", { name: "Aporte al fondo" })).toBeInTheDocument();
    expect(definition("Tipo")).toBe("Aporte al fondo");
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
    expect(described()).toBe("+3.200.000 COP");
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
    expect(shares.map((item) => norm(item.textContent))).toEqual([
      "Ana (tú) 150.000 COP",
      "Juan 150.000 COP",
    ]);
    expect(definition("División")).toContain("Iguales");
    // P344: anyone who records money corrects it; only Juan still chooses his account.
    expect(screen.getByRole("link", { name: "Editar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeInTheDocument();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  describe("the viewer's own account in a shared space (issue #165)", () => {
    const paidBy = (memberId: string, accountId: string) =>
      transactionDto({
        id: "t-4",
        type: "EXPENSE",
        description: "Groceries",
        amount: cop(120_000),
        payments: [{ memberId, accountId, amount: cop(120_000) }],
        shares: [
          { memberId: "m-ana", amount: cop(60_000), splitMethod: "EQUAL" },
          { memberId: "m-juan", amount: cop(60_000), splitMethod: "EQUAL" },
        ],
      });
    const asAna = (tx: TransactionDto): TransactionDetail => ({
      ...detailOf(tx, [anaMember, juan], { ...ana, memberId: "m-ana" }),
      ownAccountNames: { "a-ana-savings": "Ahorros Ana" },
    });

    it("names the account the viewer paid from in their personal space", () => {
      open(asAna(paidBy("m-ana", "a-ana-savings")));
      expect(definition("Pagó")).toBe("Ana (tú)");
      expect(definition("Cuenta")).toBe("Ahorros Ana");
    });

    it("keeps another member's account private", () => {
      open(asAna(paidBy("m-juan", "a-juan")));
      expect(definition("Pagó")).toBe("Juan");
      expect(definition("Cuenta")).toBe("Cuenta de Juan");
    });

    it("is also English", () => {
      const { unmount } = open(asAna(paidBy("m-ana", "a-ana-savings")), ORIGIN, "en");
      expect(definition("Account")).toBe("Ahorros Ana");
      unmount();
      open(asAna(paidBy("m-juan", "a-juan")), ORIGIN, "en");
      expect(definition("Account")).toBe("Juan's account");
    });
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
    expect(described()).toBe("500.000 COP");
    expect(terms()).not.toContain("Categoría");
    expect(terms()).not.toContain("Cuenta");
  });

  it("shows an expense in its own currency and what its account paid in the account's (P342, board 4)", () => {
    open(
      detailOf(
        transactionDto({
          id: "t-usd",
          type: "EXPENSE",
          description: "Figma",
          amount: { amount: "5000", currency: "USD" },
          categoryId: "c-veg",
          payments: [
            {
              memberId: "m-ana",
              accountId: "a-bank",
              amount: { amount: "5000", currency: "USD" },
              accountAmount: cop(205_000),
            },
          ],
        }),
      ),
    );
    expect(described()).toBe("−\u206050 USD");
    expect(definition("Cuenta")).toBe("Bancolombia");
    expect(definition("Tu cuenta pagó")).toBe("205.000 COP");
    expect(terms()).not.toContain("En su moneda");
  });

  it("shows no account leg on an expense its account paid in its own currency", () => {
    open(
      detailOf(
        transactionDto({
          id: "t-cop",
          type: "EXPENSE",
          amount: cop(85_000),
          payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(85_000) }],
        }),
      ),
    );
    expect(terms()).not.toContain("Tu cuenta pagó");
  });

  it("shows each leg in its own currency on a transfer across currencies (board 10, D29)", () => {
    open(
      detailOf(
        transactionDto({
          id: "t-xfer",
          type: "TRANSFER",
          description: "To Chase",
          amount: cop(400_000),
          sourceAccountId: "a-bank",
          destinationAccountId: "a-visa",
          sourceAmount: cop(400_000),
          destinationAmount: { amount: "10000", currency: "USD" },
        }),
      ),
    );
    expect(definition("Desde")).toBe("Bancolombia · 400.000 COP");
    expect(definition("Hacia")).toBe("Visa · 100 USD");
  });

  it("shows a settlement's two members and their accounts, and offers Editar to a MEMBER who is no party (P344)", () => {
    const settlement = transactionDto({
      id: "t-5",
      type: "SETTLEMENT",
      description: "",
      amount: cop(50_000),
      payerMemberId: "m-juan",
      receivingMemberId: "m-ana",
      destinationAccountId: "a-ana",
    });
    const luis = memberDto({ id: "m-luis", userId: "u-luis", displayName: "Luis", role: "MEMBER" });
    open(
      detailOf(settlement, [anaMember, juan, luis], { userId: "u-luis", role: "MEMBER", memberId: "m-luis" }),
    );
    expect(definition("Desde")).toBe("Juan");
    expect(definition("Hacia")).toBe("Ana");
    expect(definition("Llega a")).toBe("Cuenta de Ana");
    // Juan's side has no account, and only Juan could say which: nobody else is asked to.
    expect(terms()).not.toContain("Sale de");
    expect(screen.queryByText("Sin cuenta asignada")).toBeNull();
    expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute(
      "href",
      `/spaces/s-1/transactions/t-5/edit?returnTo=${encodeURIComponent(ORIGIN)}`,
    );
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
      ownAccountNames: {},
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

describe("a payment for someone else and a forgiven debt (P322)", () => {
  const kamilox = memberDto({ id: "m-kami", userId: "u-kami", displayName: "Kamilox", role: "MEMBER" });
  const benekin = guestDto({ id: "m-benekin", displayName: "Benekin" });
  const camilou = guestDto({ id: "m-camilou", displayName: "Camilou" });
  const friends = [kamilox, benekin, camilou];
  const asKamilox = { userId: "u-kami", role: "MEMBER", memberId: "m-kami" } as const;
  const settlement = (overrides: Partial<TransactionDto>) =>
    transactionDto({
      id: "t-p",
      type: "SETTLEMENT",
      description: "",
      amount: cop(4_500),
      payerMemberId: "m-kami",
      receivingMemberId: "m-camilou",
      settlementReason: "PAYMENT",
      ...overrides,
    });

  it("says Pago por Benekin for a payment Kamilox lent him", () => {
    open(detailOf(settlement({ onBehalfOfMemberId: "m-benekin" }), friends, asKamilox));
    expect(screen.getByRole("dialog", { name: "Pago por Benekin" })).toBeInTheDocument();
    expect(definition("Tipo")).toBe("Pago por Benekin");
    expect(definition("Desde")).toBe("Kamilox (tú)");
    expect(definition("Hacia")).toBe("Camilou (invitado)");
  });

  it("says Pago por Benekin · se lo regaló for both halves of a gift", () => {
    const lent = open(
      detailOf(
        settlement({ onBehalfOfMemberId: "m-benekin", linkedTransactionId: "t-g" }),
        friends,
        asKamilox,
      ),
    );
    expect(definition("Tipo")).toBe("Pago por Benekin · se lo regaló");
    lent.unmount();
    open(
      detailOf(
        settlement({
          id: "t-g",
          settlementReason: "GIFT",
          payerMemberId: "m-benekin",
          receivingMemberId: "m-kami",
          linkedTransactionId: "t-p",
        }),
        friends,
        asKamilox,
      ),
    );
    expect(definition("Tipo")).toBe("Pago por Benekin · se lo regaló");
  });

  it("says Deuda perdonada for a forgiveness, in its row too", () => {
    const forgiven = settlement({
      settlementReason: "FORGIVENESS",
      payerMemberId: "m-benekin",
      receivingMemberId: "m-camilou",
    });
    open(detailOf(forgiven, friends, asKamilox));
    expect(screen.getByRole("dialog", { name: "Deuda perdonada" })).toBeInTheDocument();
    expect(definition("Tipo")).toBe("Deuda perdonada");
    expect(kindOf(forgiven)).toBe("FORGIVENESS");
    expect(kindOf(settlement({}))).toBe("SETTLEMENT");
  });

  it("keeps a plain settlement's type and reads in English", () => {
    const english = open(
      detailOf(settlement({ onBehalfOfMemberId: "m-benekin" }), friends, asKamilox),
      ORIGIN,
      "en",
    );
    expect(definition("Type")).toBe("Payment for Benekin");
    english.unmount();
    open(detailOf(settlement({}), friends, asKamilox));
    expect(definition("Tipo")).toBe("Pago entre miembros");
  });
});

describe("an expense paid for the fund (D26, P328)", () => {
  const asAna = { ...ana, memberId: "m-ana" };
  const contribution = transactionDto({
    id: "t-c",
    type: "TRANSFER",
    description: "Rent",
    amount: cop(900_000),
    categoryId: null,
    payerMemberId: "m-ana",
    sourceAccountId: "a-bank",
    destinationAccountId: "a-visa",
    payments: [],
    shares: [],
    linkedTransactionId: "t-e",
  });
  const expense = transactionDto({
    id: "t-e",
    type: "EXPENSE",
    description: "Rent",
    amount: cop(900_000),
    payments: [{ memberId: null, accountId: "a-visa", amount: cop(900_000) }],
    shares: [{ memberId: "m-ana", amount: cop(900_000), splitMethod: "EQUAL" }],
    linkedTransactionId: "t-c",
  });

  it("offers no Editar on either half, keeps Eliminar and says deleting it deletes both", () => {
    for (const half of [contribution, expense]) {
      const sheet = open(detailOf(half, [anaMember, juan], asAna));
      expect(screen.queryByRole("link", { name: "Editar" })).toBeNull();
      expect(screen.getByRole("button", { name: "Eliminar" })).toBeEnabled();
      expect(norm(screen.getByRole("dialog").textContent)).toContain(
        "Es parte de un gasto pagado por el fondo: no se edita. Si lo eliminas, también se elimina la otra parte.",
      );
      sheet.unmount();
    }
  });

  it("still offers Editar on an expense the fund paid on its own, and reads in English", () => {
    const alone = open(detailOf({ ...expense, linkedTransactionId: null }, [anaMember, juan], asAna));
    expect(screen.getByRole("link", { name: "Editar" })).toBeInTheDocument();
    alone.unmount();
    open(detailOf(expense, [anaMember, juan], asAna), ORIGIN, "en");
    expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    expect(norm(screen.getByRole("dialog").textContent)).toContain(
      "Part of an expense paid for the fund: it can't be edited. Deleting it deletes the other part too.",
    );
  });
});

describe("a balance adjustment's detail (design Q4, #329)", () => {
  const adjustment = transactionDto({
    id: "t-adjust",
    type: "ADJUSTMENT",
    description: "",
    amount: cop(20_000),
    date: "2026-10-31",
    categoryId: null,
    payments: [],
    shares: [],
    sourceAccountId: "a-bank",
    destinationAccountId: null,
  });

  it("shows its kind, its account and a signed amount, and offers Eliminar only", () => {
    open(detailOf(adjustment));
    expect(screen.getByRole("dialog", { name: "Ajuste de saldo" })).toBeInTheDocument();
    expect(described()).toBe("−\u206020.000 COP");
    expect(definition("Tipo")).toBe("Ajuste de saldo");
    expect(definition("Cuenta")).toBe("Bancolombia");
    expect(terms()).not.toContain("Categoría");
    expect(screen.queryByRole("link", { name: "Editar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeEnabled();
  });

  it("signs money in with a plus and reads Balance adjustment in English", () => {
    open(detailOf({ ...adjustment, sourceAccountId: null, destinationAccountId: "a-bank" }), ORIGIN, "en");
    expect(described()).toBe("+20.000 COP");
    expect(definition("Type")).toBe("Balance adjustment");
  });

  it("offers a VIEWER nothing to do with it", () => {
    open(detailOf(adjustment, [], { userId: "u-sofi", role: "VIEWER", memberId: null }));
    expect(screen.queryByRole("button", { name: "Eliminar" })).toBeNull();
  });
});

describe("a side that is the viewer's with no account (P344, S6, board 2)", () => {
  const sofia = memberDto({ id: "m-sofia", userId: "u-sofia", displayName: "Sofía", role: "MEMBER" });
  const juanViews = { userId: "u-juan", role: "MEMBER", memberId: "m-juan" } as const;
  const payment = transactionDto({
    id: "t-pay",
    type: "SETTLEMENT",
    description: "",
    amount: cop(947_000),
    payerMemberId: "m-juan",
    receivingMemberId: "m-ana",
    sourceAccountId: null,
    destinationAccountId: "a-ana",
  });
  const EDIT = `/spaces/s-1/transactions/t-pay/edit?returnTo=${encodeURIComponent(ORIGIN)}`;
  // P344 (S6): the row opens the edit with the side's own-account picker already open.
  const PICK = (side: "out" | "in") =>
    `/spaces/s-1/transactions/t-pay/edit?pick=${side}&returnTo=${encodeURIComponent(ORIGIN)}`;

  it("tells the payer it has no account and opens the picker of the one it left from", async () => {
    open(detailOf(payment, [anaMember, juan, sofia], juanViews));
    const assign = screen.getByRole("link", { name: /Sin cuenta asignada/ });
    expect(norm(assign.textContent)).toBe("Sin cuenta asignada Sale de · elige de qué cuenta salió");
    expect(assign).toHaveAttribute("href", PICK("out"));
    // The sheet's own actions are as before: Editar opens the edit as it is, and Eliminar is there.
    expect(screen.getByRole("link", { name: "Editar" })).toHaveAttribute("href", EDIT);
    expect(screen.getByRole("button", { name: "Eliminar" })).toBeEnabled();
    expect(definition("Llega a")).toBe("Cuenta de Ana");
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("tells the receiver which account it reached", () => {
    open(
      detailOf({ ...payment, sourceAccountId: "a-juan", destinationAccountId: null }, [anaMember, juan], {
        ...ana,
        memberId: "m-ana",
      }),
    );
    const assign = screen.getByRole("link", { name: /Sin cuenta asignada/ });
    expect(norm(assign.textContent)).toBe("Sin cuenta asignada Llega a · elige a qué cuenta llegó");
    expect(assign).toHaveAttribute("href", PICK("in"));
    expect(definition("Sale de")).toBe("Cuenta de Juan");
  });

  it("asks the viewer who paid an expense with no account to choose it", () => {
    const dinner = transactionDto({
      id: "t-pay",
      type: "EXPENSE",
      amount: cop(60_000),
      payments: [{ memberId: "m-juan", accountId: null, amount: cop(60_000) }],
      shares: [{ memberId: "m-juan", amount: cop(60_000), splitMethod: "EQUAL" }],
    });
    open(detailOf(dinner, [anaMember, juan], juanViews));
    expect(screen.getByRole("link", { name: /Sin cuenta asignada/ })).toHaveAttribute("href", PICK("out"));
  });

  it("says it in English too", () => {
    open(detailOf(payment, [anaMember, juan], juanViews), ORIGIN, "en");
    expect(norm(screen.getByRole("link", { name: /No account assigned/ }).textContent)).toBe(
      "No account assigned Leaves from · choose the account it left",
    );
  });
});

describe("a movement's history (P344, S7, board 2)", () => {
  const sofia = memberDto({ id: "m-sofia", userId: "u-sofia", displayName: "Sofía", role: "MEMBER" });
  const juanViews = { userId: "u-juan", role: "MEMBER", memberId: "m-juan" } as const;
  const payment = transactionDto({
    id: "t-pay",
    type: "SETTLEMENT",
    description: "",
    amount: cop(947_000),
    payerMemberId: "m-juan",
    receivingMemberId: "m-ana",
    destinationAccountId: "a-ana",
    createdBy: "u-ana",
    createdAt: "2026-11-13T02:41:00.000Z",
  });
  const history: NonNullable<TransactionDetail["history"]> = [
    {
      id: "au-1",
      action: "UPDATED",
      actorUserId: "u-ana",
      actorName: "Ana",
      at: "2026-11-13T02:45:00.000Z",
      changes: { payerMemberId: { from: "m-sofia", to: "m-juan" } },
    },
    {
      id: "au-2",
      action: "UPDATED",
      actorUserId: "u-gone",
      actorName: null,
      at: "2026-11-14T15:00:00.000Z",
      changes: {
        amount: { from: "94700000", to: "95000000" },
        sourceAmount: { from: null, to: "95000000 COP" },
        date: { from: "2026-11-12", to: "2026-11-11" },
      },
    },
    {
      id: "au-3",
      action: "DELETED",
      actorUserId: "u-juan",
      actorName: "Juan",
      at: "2026-11-15T15:00:00.000Z",
      changes: { amount: { from: "95000000", to: null } },
    },
    {
      id: "au-4",
      action: "RESTORED",
      actorUserId: "u-juan",
      actorName: "Juan",
      at: "2026-11-15T15:01:00.000Z",
      changes: { amount: { from: null, to: "95000000" } },
    },
  ];
  const lines = (name = "Historial") =>
    within(screen.getByRole("list", { name }))
      .getAllByRole("listitem")
      .map((item) => norm(item.textContent));

  it("lists who changed what and when, newest first, ending with who recorded it", async () => {
    open({ ...detailOf(payment, [anaMember, juan, sofia], juanViews), history });
    expect(lines()).toEqual([
      "Restauraste el pago 15/11/2026, 10:01",
      "Eliminaste el pago 15/11/2026, 10:00",
      "Alguien cambió el monto: 947.000 COP → 950.000 COP Alguien cambió la fecha: 12/11/2026 → 11/11/2026 14/11/2026, 10:00",
      "Ana cambió quién pagó: Sofía → Juan 12/11/2026, 21:45",
      "Ana registró el pago 12/11/2026, 21:41",
    ]);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("reads in English", () => {
    open(
      { ...detailOf(payment, [anaMember, juan, sofia], juanViews), history: history.slice(0, 1) },
      ORIGIN,
      "en",
    );
    expect(lines("History")).toEqual([
      "Ana changed who paid: Sofía → Juan 12/11/2026, 21:45",
      "Ana recorded the payment 12/11/2026, 21:41",
    ]);
  });

  it("shows no history while it has not been read", () => {
    open(detailOf(payment, [anaMember, juan], juanViews));
    expect(screen.queryByRole("list", { name: "Historial" })).toBeNull();
  });
});
