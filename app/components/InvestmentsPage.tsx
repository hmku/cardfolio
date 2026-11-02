"use client";

import { useCallback, useMemo } from "react";
import { loadBankAccounts, loadHoldings } from "../lib/finance-data";
import { accountLabel, moneyExact, moneyWhole } from "../lib/presentation/finance-format";
import { FinanceEmpty, FinanceSection, useFinanceLoad, type FinancePageProps } from "./FinanceShared";

/** Investments tab (placeholder): every holding by value, with its account. */
export function InvestmentsPage({ context, onOpenSettings }: FinancePageProps) {
  const load = useCallback(async () => {
    const [holdings, accounts] = await Promise.all([loadHoldings(context), loadBankAccounts(context)]);
    return { holdings, accounts };
  }, [context]);
  const { data, error, reload } = useFinanceLoad(load);
  const accountById = useMemo(() => new Map((data?.accounts || []).map((account) => [account.id, account])), [data]);
  const total = (data?.holdings || []).reduce((sum, holding) => sum + (holding.institutionValueCents ?? 0), 0);

  return (
    <FinanceSection title="Investments" actions={data?.holdings.length ? <span className="num finance-total">{moneyWhole(total)}</span> : undefined} error={error} onRetry={() => void reload()}>
      {!data ? <p className="hint">Loading…</p> : data.holdings.length === 0 ? (
        <FinanceEmpty onOpenSettings={onOpenSettings}>No holdings yet. Connect a brokerage or retirement account with &ldquo;Connect investments&rdquo;.</FinanceEmpty>
      ) : (
        <ul className="finance-list">
          {data.holdings.map((holding) => {
            const account = accountById.get(holding.plaidAccountId);
            return (
              <li key={holding.id} className="finance-row">
                <span className="grow">
                  {holding.security.tickerSymbol ? <strong>{holding.security.tickerSymbol} </strong> : null}{holding.security.name || "Security"}
                  <small>{holding.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })} {holding.institutionPrice !== null ? `@ ${moneyExact(Math.round(holding.institutionPrice * 100))}` : ""}{account ? ` · ${accountLabel(account)}` : ""}</small>
                </span>
                <span className="num amount">{holding.institutionValueCents === null ? "—" : moneyExact(holding.institutionValueCents)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </FinanceSection>
  );
}
