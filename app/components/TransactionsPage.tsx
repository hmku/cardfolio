"use client";

import { useCallback, useMemo } from "react";
import { loadBankAccounts, loadCategories, loadTransactions } from "../lib/finance-data";
import { accountLabel, transactionAmount } from "../lib/presentation/finance-format";
import { shortDate } from "../lib/presentation/format";
import { FinanceEmpty, FinanceSection, useFinanceLoad, type FinancePageProps } from "./FinanceShared";

/** Transactions tab (placeholder): the latest 50 transactions with their category and account. */
export function TransactionsPage({ context, onOpenSettings }: FinancePageProps) {
  const load = useCallback(async () => {
    const [{ transactions }, categories, accounts] = await Promise.all([loadTransactions(context, { limit: 50 }), loadCategories(context), loadBankAccounts(context)]);
    return { transactions, categories, accounts };
  }, [context]);
  const { data, error, reload } = useFinanceLoad(load);
  const categoryById = useMemo(() => new Map((data?.categories || []).map((category) => [category.id, category])), [data]);
  const accountById = useMemo(() => new Map((data?.accounts || []).map((account) => [account.id, account])), [data]);

  return (
    <FinanceSection title="Transactions" error={error} onRetry={() => void reload()}>
      {!data ? <p className="hint">Loading…</p> : data.transactions.length === 0 ? (
        <FinanceEmpty onOpenSettings={data.accounts.length ? undefined : onOpenSettings}>
          {data.accounts.length ? "No transactions yet. Plaid can take a few minutes to gather the first ones after connecting." : "Connect a bank or card to see its transactions here."}
        </FinanceEmpty>
      ) : (
        <ul className="finance-list">
          {data.transactions.map((transaction) => {
            const category = transaction.categoryId === null ? null : categoryById.get(transaction.categoryId);
            const account = accountById.get(transaction.plaidAccountId);
            return (
              <li key={transaction.id} className={`finance-row${transaction.excluded ? " dim" : ""}`}>
                <span className="when">{shortDate(transaction.authorizedDate || transaction.date)}</span>
                <span className="grow">
                  {transaction.merchantName || transaction.name}
                  <small>{category ? `${category.emoji ? `${category.emoji} ` : ""}${category.name}` : "Uncategorized"}{account ? ` · ${accountLabel(account)}` : ""}{transaction.pending ? " · pending" : ""}</small>
                </span>
                <span className={`num amount${transaction.amountCents > 0 ? " in" : ""}`}>{transactionAmount(transaction.amountCents)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </FinanceSection>
  );
}
