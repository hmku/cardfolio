"use client";

import { useCallback } from "react";
import { cashFlowByMonth, monthsBefore } from "../lib/core/finance";
import { isoDate } from "../lib/core/dates";
import { loadCashFlowTransactions, loadCategories } from "../lib/finance-data";
import { moneyWhole } from "../lib/presentation/finance-format";
import { monthYear } from "../lib/presentation/format";
import { FinanceEmpty, FinanceSection, useFinanceLoad, type FinancePageProps } from "./FinanceShared";

/** Cash flow tab (placeholder): income, spending and net for the last six months. */
export function CashFlowPage({ context, onOpenSettings }: FinancePageProps) {
  const load = useCallback(async () => {
    const today = isoDate(new Date());
    const from = `${monthsBefore(today, 5).slice(0, 7)}-01`;
    const [transactions, categories] = await Promise.all([loadCashFlowTransactions(context, from, today), loadCategories(context)]);
    return cashFlowByMonth(transactions, categories);
  }, [context]);
  const { data, error, reload } = useFinanceLoad(load);

  return (
    <FinanceSection title="Cash flow" error={error} onRetry={() => void reload()}>
      {!data ? <p className="hint">Loading…</p> : data.length === 0 ? (
        <FinanceEmpty onOpenSettings={onOpenSettings}>No transactions in the last six months yet.</FinanceEmpty>
      ) : (
        <ul className="finance-list">
          {data.map((month) => (
            <li key={month.month} className="finance-row">
              <span className="grow">
                {monthYear(`${month.month}-01`)}
                <small>In {moneyWhole(month.incomeCents)} · out {moneyWhole(month.expenseCents)}</small>
              </span>
              <span className={`num amount${month.netCents > 0 ? " in" : ""}`}>{moneyWhole(month.netCents)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">Transfers, card payments and excluded transactions don&apos;t count.</p>
    </FinanceSection>
  );
}
