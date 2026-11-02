"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Portfolio } from "../lib/core/model";
import type { FinanceContext } from "../lib/finance-data";
import type { TransactionFilters } from "../lib/presentation/transaction-view";

/** What Portfolio passes to every finance page (Transactions, Cash flow, Investments, Accounts). */
export type FinancePageProps = {
  context: FinanceContext;
  /** Cards, people and products, e.g. to name a linked card or a person. */
  portfolio: Portfolio;
  notify: (text: string, error?: boolean) => void;
  /** Opens Settings (bank connections live there). */
  onOpenSettings: () => void;
  /** The Transactions tab's filters, kept by Portfolio so they survive tab switches. */
  transactionFilters: TransactionFilters;
  onTransactionFilters: (filters: TransactionFilters) => void;
  /** Opens the Transactions tab with these filters (the rest reset), e.g. from Cash flow. */
  onShowTransactions: (filters: Partial<TransactionFilters>) => void;
};

/**
 * Loads data for a page: `data` is null until the first load finishes; `reload()` loads again.
 * The loader must be stable (useCallback) or it reloads on every render.
 */
export function useFinanceLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      setData(await load());
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't load this page.");
    }
  }, [load]);
  useEffect(() => {
    let active = true;
    load().then((value) => { if (active) { setData(value); setError(""); } }, (reason) => { if (active) setError(reason instanceof Error ? reason.message : "Couldn't load this page."); });
    return () => { active = false; };
  }, [load]);
  return { data, error, reload };
}

/** Page frame: a heading row (title + optional actions), a load error, then the content. */
export function FinanceSection({ title, actions, error, onRetry, children }: { title: string; actions?: ReactNode; error?: string; onRetry?: () => void; children: ReactNode }) {
  return (
    <section className="finance-page">
      <div className="finance-head">
        <h2>{title}</h2>
        {actions}
      </div>
      {error && <div className="error-banner" role="alert"><span>{error}</span>{onRetry && <button type="button" className="btn small" onClick={onRetry}>Retry</button>}</div>}
      {children}
    </section>
  );
}

/** Shown when there's nothing to list yet. */
export function FinanceEmpty({ children, onOpenSettings }: { children: ReactNode; onOpenSettings?: () => void }) {
  return (
    <div className="finance-empty">
      <p>{children}</p>
      {onOpenSettings && <button type="button" className="btn small" onClick={onOpenSettings}>Open Settings → Bank connections</button>}
    </div>
  );
}
