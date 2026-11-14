import type { AccountRepository } from "@/modules/accounts/application";
import { positionOf, type TransactionsAcrossQuery } from "@/modules/ledger/application";
import type { AccountMovement, AccountMovements } from "@/modules/reporting/application";

/** How many movements each read of the ledger's list brings; an account rarely has more in one period. */
const PAGE = 500;

/**
 * Ruling P327: an account's movements for its screen's figures, from the ledger's own list filtered by the account
 * (P277), page by page in its order (P43), so every movement of the period counts once; and the account's space.
 */
export const accountMovementsOf = (
  accounts: Pick<AccountRepository, "findById">,
  ledger: Pick<TransactionsAcrossQuery, "listAcross">,
): AccountMovements => ({
  spaceOf: async (accountId) => (await accounts.findById(accountId))?.spaceId ?? null,
  movementsOf: async (accountId, spaceIds, from, to) => {
    const found: AccountMovement[] = [];
    let after = null;
    for (;;) {
      const rows = await ledger.listAcross({ spaceIds, from, to, accountId }, after, PAGE);
      for (const tx of rows) {
        const expense = tx.type === "EXPENSE";
        found.push({
          spaceId: tx.spaceId,
          type: tx.type,
          categoryId: tx.categoryId,
          amount: tx.amount,
          paid: expense
            ? tx.payments.reduce((sum, p) => (p.accountId === accountId ? sum + p.amount : sum), 0n)
            : 0n,
          sourceAccountId: "sourceAccountId" in tx ? tx.sourceAccountId : null,
          destinationAccountId: "destinationAccountId" in tx ? tx.destinationAccountId : null,
          betweenOwnAccounts: tx.type === "TRANSFER" && tx.payerMemberId === null,
        });
      }
      const last = rows.at(-1);
      if (rows.length < PAGE || last === undefined) return found;
      after = positionOf(last);
    }
  },
});
