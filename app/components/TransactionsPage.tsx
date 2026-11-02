"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isoDate, parseDate } from "../lib/core/dates";
import type { DatePreset } from "../lib/core/finance";
import {
  loadBankAccounts, loadCategories, loadCategoryRules, loadTransactions, updateTransactions,
  type Transaction, type TransactionPatch,
} from "../lib/finance-data";
import { bankAccountLabel } from "../lib/presentation/account-labels";
import { transactionAmount } from "../lib/presentation/finance-format";
import {
  activeFilterCount, DATE_PRESETS, DEFAULT_TRANSACTION_FILTERS, filtersToQuery, groupByDate, type TransactionFilters,
} from "../lib/presentation/transaction-view";
import { CategoryPicker, categoryLabel } from "./CategoryPicker";
import { CategorySettings } from "./CategorySettings";
import { FinanceEmpty, FinanceSection, useFinanceLoad, type FinancePageProps } from "./FinanceShared";
import { TransactionDrawer } from "./TransactionDrawer";
import { Tag } from "./ui";

const PAGE_SIZE = 100;
const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" });
const dayYearFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

function dayHeading(date: string, today: string) {
  if (date === today) return "Today";
  const parsed = parseDate(date);
  if (!parsed) return date;
  const yesterday = parseDate(today);
  yesterday?.setDate(yesterday.getDate() - 1);
  if (yesterday && isoDate(yesterday) === date) return "Yesterday";
  return (date.slice(0, 4) === today.slice(0, 4) ? dayFormat : dayYearFormat).format(parsed);
}

/** The merchant's logo, or the category emoji when there's none (or it fails to load). */
function TransactionIcon({ transaction, emoji }: { transaction: Transaction; emoji: string }) {
  const [failed, setFailed] = useState(false);
  if (transaction.logoUrl && !failed) {
    // Plaid's merchant logos are small remote images; next/image would need their host configured.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="txn-icon" src={transaction.logoUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
  }
  return <span className="txn-icon" aria-hidden="true">{emoji}</span>;
}

type ListState = { items: Transaction[]; hasMore: boolean; loading: boolean; error: string };

/** Transactions tab: search, filters, a date-grouped list with paging, bulk edits and a detail drawer. */
export function TransactionsPage({ context, portfolio, notify, onOpenSettings, transactionFilters: filters, onTransactionFilters }: FinancePageProps) {
  const today = isoDate(new Date());
  const loadSetup = useCallback(async () => {
    const [categories, rules, accounts] = await Promise.all([loadCategories(context), loadCategoryRules(context), loadBankAccounts(context)]);
    return { categories, rules, accounts };
  }, [context]);
  const { data: setup, error: setupError, reload: reloadSetup } = useFinanceLoad(loadSetup);
  const [list, setList] = useState<ListState>({ items: [], hasMore: false, loading: true, error: "" });
  const [searchText, setSearchText] = useState(filters.search);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [openId, setOpenId] = useState<number | null>(null);
  const [managing, setManaging] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const request = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const query = useMemo(() => filtersToQuery(filters, today), [filters, today]);

  const setFilters = useCallback((patch: Partial<TransactionFilters>) => onTransactionFilters({ ...filters, ...patch }), [filters, onTransactionFilters]);

  // Keep the box in step when Cash flow opens this tab with a search; debounce typing.
  const [syncedSearch, setSyncedSearch] = useState(filters.search);
  if (syncedSearch !== filters.search) { setSyncedSearch(filters.search); setSearchText(filters.search); }
  useEffect(() => {
    if (searchText === filters.search) return;
    const timer = setTimeout(() => setFilters({ search: searchText }), 300);
    return () => clearTimeout(timer);
  }, [searchText, filters.search, setFilters]);

  const fetchPage = useCallback(async (offset: number) => {
    const id = ++request.current;
    setList((current) => ({ ...current, loading: true, error: "", ...(offset === 0 && { hasMore: false }) }));
    try {
      const page = await loadTransactions(context, { ...query, limit: PAGE_SIZE, offset });
      if (id !== request.current) return;
      setList((current) => ({ items: offset === 0 ? page.transactions : [...current.items, ...page.transactions], hasMore: page.hasMore, loading: false, error: "" }));
    } catch (reason) {
      if (id !== request.current) return;
      setList((current) => ({ ...current, loading: false, error: reason instanceof Error ? reason.message : "Couldn't load transactions." }));
    }
  }, [context, query]);

  useEffect(() => {
    setSelected(new Set());
    void fetchPage(0);
  }, [fetchPage]);

  // Infinite scroll: load the next page when the end of the list comes into view.
  const loadMore = useCallback(() => { if (list.hasMore && !list.loading) void fetchPage(list.items.length); }, [fetchPage, list.hasMore, list.loading, list.items.length]);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !list.hasMore || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) loadMore(); }, { rootMargin: "400px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore, list.hasMore]);

  const categoryById = useMemo(() => new Map((setup?.categories || []).map((category) => [category.id, category])), [setup]);
  const accountById = useMemo(() => new Map((setup?.accounts || []).map((account) => [account.id, account])), [setup]);
  const groups = useMemo(() => groupByDate(list.items), [list.items]);
  const openTransaction = openId === null ? undefined : list.items.find((item) => item.id === openId);
  const filterCount = activeFilterCount(filters);
  // The date select sits outside the Filters panel, so the button counts the rest.
  const panelCount = filterCount - (filters.datePreset !== "all" ? 1 : 0);

  const replaceItem = (transaction: Transaction) => setList((current) => ({ ...current, items: current.items.map((item) => (item.id === transaction.id ? transaction : item)) }));

  async function bulk(patch: TransactionPatch, done: string) {
    const ids = [...selected];
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      await updateTransactions(context, ids, patch);
      const chosen = new Set(ids);
      setList((current) => ({
        ...current,
        items: current.items.map((item) => (chosen.has(item.id) ? {
          ...item,
          ...(patch.categoryId !== undefined && { categoryId: patch.categoryId, categorySource: "manual" as const }),
          ...(patch.excluded !== undefined && { excluded: patch.excluded }),
          ...(patch.reviewed !== undefined && { reviewed: patch.reviewed }),
        } : item)),
      }));
      setSelected(new Set());
      notify(`${done} ${ids.length} transaction${ids.length === 1 ? "" : "s"}`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Couldn't save the transactions.", true);
    } finally {
      setBulkBusy(false);
    }
  }

  const toggle = (id: number) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const accountsSorted = useMemo(() => (setup?.accounts || [])
    .map((account) => ({ account, label: bankAccountLabel(account, portfolio) }))
    .sort((left, right) => left.label.localeCompare(right.label)), [setup, portfolio]);
  const noAccounts = setup && setup.accounts.length === 0;
  const filtered = filters.search.trim() !== "" || filterCount > 0;

  return (
    <FinanceSection
      title="Transactions"
      error={setupError || list.error}
      onRetry={() => { void reloadSetup(); void fetchPage(0); }}
      actions={<button type="button" className="btn small" disabled={!setup} onClick={() => setManaging(true)}>Manage categories</button>}
    >
      <div className="txn-toolbar">
        <input className="search txn-search" type="search" aria-label="Search transactions" placeholder="Search merchant, description or notes" value={searchText} onChange={(event) => setSearchText(event.target.value)} />
        <select className="txn-select" aria-label="Dates" value={filters.datePreset} onChange={(event) => setFilters({ datePreset: event.target.value as DatePreset })}>
          {DATE_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
        </select>
        <button type="button" className="btn" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>Filters{panelCount > 0 ? ` (${panelCount})` : ""}</button>
        {filtered && <button type="button" className="btn link" onClick={() => { setSearchText(""); onTransactionFilters(DEFAULT_TRANSACTION_FILTERS); }}>Clear</button>}
      </div>

      {filters.datePreset === "custom" && (
        <div className="txn-filters txn-custom-dates">
          <label className="f">From<input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => setFilters({ from: event.target.value })} /></label>
          <label className="f">To<input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => setFilters({ to: event.target.value })} /></label>
        </div>
      )}

      {showFilters && setup && (
        <div className="txn-filters">
          <label className="f">Category
            <select value={filters.category === null ? "" : String(filters.category)} onChange={(event) => setFilters({ category: event.target.value === "" ? null : event.target.value === "none" ? "none" : Number(event.target.value) })}>
              <option value="">Any category</option>
              <option value="none">Uncategorized</option>
              {setup.categories.map((category) => <option key={category.id} value={category.id}>{categoryLabel(category)}</option>)}
            </select>
          </label>
          <div className="f">
            <span>Money</span>
            <div className="seg" role="group" aria-label="Money in or out">
              {(["all", "in", "out"] as const).map((direction) => (
                <button key={direction} type="button" aria-pressed={filters.direction === direction} onClick={() => setFilters({ direction })}>{direction === "all" ? "All" : direction === "in" ? "In" : "Out"}</button>
              ))}
            </div>
          </div>
          <fieldset className="txn-accounts">
            <legend>Accounts{filters.accountIds.length ? ` (${filters.accountIds.length})` : ""}</legend>
            {accountsSorted.map(({ account, label }) => (
              <label key={account.id} className="check">
                <input type="checkbox" checked={filters.accountIds.includes(account.id)}
                  onChange={(event) => setFilters({ accountIds: event.target.checked ? [...filters.accountIds, account.id] : filters.accountIds.filter((id) => id !== account.id) })} />
                {label}
              </label>
            ))}
            {!accountsSorted.length && <span className="hint">No accounts connected.</span>}
          </fieldset>
          <div className="txn-flags">
            <label className="check"><input type="checkbox" checked={filters.showExcluded} onChange={(event) => setFilters({ showExcluded: event.target.checked })} /> Show excluded</label>
            <label className="check"><input type="checkbox" checked={filters.unreviewedOnly} onChange={(event) => setFilters({ unreviewedOnly: event.target.checked })} /> Unreviewed only</label>
          </div>
        </div>
      )}

      {selected.size > 0 && setup && (
        <div className="bulk-bar" role="region" aria-label="Edit selected transactions">
          <strong>{selected.size} selected</strong>
          <CategoryPicker categories={setup.categories} value={null} placeholder="Set category…" label="Set category for selected" onChange={(id) => { if (id !== null) void bulk({ categoryId: id }, "Recategorized"); }} />
          <button type="button" className="btn small" disabled={bulkBusy} onClick={() => void bulk({ excluded: true }, "Excluded")}>Exclude</button>
          <button type="button" className="btn small" disabled={bulkBusy} onClick={() => void bulk({ excluded: false }, "Included")}>Include</button>
          <button type="button" className="btn small" disabled={bulkBusy} onClick={() => void bulk({ reviewed: true }, "Marked reviewed:")}>Mark reviewed</button>
          <button type="button" className="btn small" onClick={() => setSelected(new Set(list.items.map((item) => item.id)))}>Select all {list.items.length}</button>
          <button type="button" className="btn link" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {!setup || (list.loading && !list.items.length) ? <p className="hint">Loading…</p> : noAccounts ? (
        <FinanceEmpty onOpenSettings={onOpenSettings}>Connect a bank or card to see its transactions here.</FinanceEmpty>
      ) : !list.items.length ? (
        <FinanceEmpty>{filtered ? "No transactions match these filters." : "No transactions yet. Plaid can take a few minutes to gather the first ones after connecting."}</FinanceEmpty>
      ) : (
        <div className={`txn-list${list.loading ? " refreshing" : ""}`}>
          {groups.map((group) => (
            <section key={group.date} className="txn-day" aria-label={dayHeading(group.date, today)}>
              <h3 className="txn-day-head">{dayHeading(group.date, today)}</h3>
              <ul>
                {group.items.map((transaction) => {
                  const category = transaction.categoryId === null ? null : categoryById.get(transaction.categoryId);
                  const account = bankAccountLabel(accountById.get(transaction.plaidAccountId), portfolio);
                  const name = transaction.merchantName || transaction.name;
                  return (
                    <li key={transaction.id} className={`txn-row${transaction.excluded ? " dim" : ""}${selected.has(transaction.id) ? " selected" : ""}`}>
                      <input type="checkbox" className="txn-check" aria-label={`Select ${name}, ${transactionAmount(transaction.amountCents)}`} checked={selected.has(transaction.id)} onChange={() => toggle(transaction.id)} />
                      <button type="button" className="txn-main" onClick={() => setOpenId(transaction.id)}>
                        <TransactionIcon transaction={transaction} emoji={category?.emoji || (transaction.amountCents > 0 ? "↘" : "•")} />
                        <span className="txn-name">
                          <span className="txn-title">{name}{!transaction.reviewed && <span className="txn-unreviewed" title="Not reviewed" aria-label="not reviewed" />}</span>
                          <small className="txn-sub">{categoryLabel(category)}{account ? ` · ${account}` : ""}</small>
                        </span>
                        <span className={`txn-cat${category ? "" : " none"}`}>{categoryLabel(category)}</span>
                        <span className="txn-acct">{account}</span>
                        <span className="txn-amt">
                          <span className={`num amount${transaction.amountCents > 0 ? " in" : ""}`}>{transactionAmount(transaction.amountCents)}</span>
                          {transaction.pending && <Tag tone="due">Pending</Tag>}
                          {transaction.excluded && <span className="txn-flag">Excluded</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <div ref={sentinel} />
          {list.hasMore && <button type="button" className="btn show-more" disabled={list.loading} onClick={loadMore}>{list.loading ? "Loading…" : "Load more"}</button>}
          {!list.hasMore && list.items.length > PAGE_SIZE && <p className="hint">That&apos;s all {list.items.length}.</p>}
        </div>
      )}

      {openTransaction && setup && (
        <TransactionDrawer
          key={openTransaction.id}
          context={context}
          portfolio={portfolio}
          transaction={openTransaction}
          categories={setup.categories}
          rules={setup.rules}
          account={accountById.get(openTransaction.plaidAccountId)}
          notify={notify}
          onUpdated={replaceItem}
          onRulesChanged={(changed) => { void reloadSetup(); if (changed) void fetchPage(0); }}
          onClose={() => setOpenId(null)}
        />
      )}

      {managing && setup && (
        <CategorySettings
          context={context}
          portfolio={portfolio}
          categories={setup.categories}
          rules={setup.rules}
          accounts={setup.accounts}
          notify={notify}
          onChanged={(changed) => { void reloadSetup(); if (changed) void fetchPage(0); }}
          onClose={() => setManaging(false)}
        />
      )}
    </FinanceSection>
  );
}
