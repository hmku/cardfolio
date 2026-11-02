"use client";

import { useCallback } from "react";
import { netWorthCents } from "../lib/core/finance";
import { isDebt, loadBankAccounts, loadManualAccounts, MANUAL_ACCOUNT_KINDS } from "../lib/finance-data";
import { accountLabel, moneyExact, moneyWhole } from "../lib/presentation/finance-format";
import { FinanceEmpty, FinanceSection, useFinanceLoad, type FinancePageProps } from "./FinanceShared";

/** Accounts tab (placeholder): every bank and manual account with its balance, and the net worth total. */
export function AccountsPage({ context, onOpenSettings }: FinancePageProps) {
  const load = useCallback(async () => {
    const [bank, manual] = await Promise.all([loadBankAccounts(context), loadManualAccounts(context)]);
    return { bank, manual: manual.filter((account) => !account.archived) };
  }, [context]);
  const { data, error, reload } = useFinanceLoad(load);
  const netWorth = data
    ? data.bank.reduce((sum, account) => sum + netWorthCents(account.type, account.currentCents ?? account.availableCents ?? 0), 0)
      + data.manual.reduce((sum, account) => sum + (account.liability ? -account.balanceCents : account.balanceCents), 0)
    : 0;
  const kindLabel = (kind: string) => MANUAL_ACCOUNT_KINDS.find((item) => item.value === kind)?.label ?? kind;

  return (
    <FinanceSection title="Accounts" actions={data ? <span className="num finance-total" title="Net worth">{moneyWhole(netWorth)}</span> : undefined} error={error} onRetry={() => void reload()}>
      {!data ? <p className="hint">Loading…</p> : data.bank.length + data.manual.length === 0 ? (
        <FinanceEmpty onOpenSettings={onOpenSettings}>No accounts yet. Connect a bank, card or brokerage to see balances here.</FinanceEmpty>
      ) : (
        <ul className="finance-list">
          {data.bank.map((account) => {
            const balance = account.currentCents ?? account.availableCents;
            return (
              <li key={`p${account.id}`} className="finance-row">
                <span className="grow">
                  {accountLabel(account)}
                  <small>{account.institutionName || "Bank"} · {account.subtype || account.type || "account"}{account.statement.nextDueDate ? ` · due ${account.statement.nextDueDate}` : ""}</small>
                </span>
                <span className="num amount">{balance === null ? "—" : moneyExact(isDebt(account) ? -balance : balance)}</span>
              </li>
            );
          })}
          {data.manual.map((account) => (
            <li key={`m${account.id}`} className="finance-row">
              <span className="grow">{account.name}<small>{kindLabel(account.kind)} · entered by hand</small></span>
              <span className="num amount">{moneyExact(account.liability ? -account.balanceCents : account.balanceCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </FinanceSection>
  );
}
