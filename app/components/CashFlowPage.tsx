"use client";

import { useCallback, useMemo, useState } from "react";
import { cashFlowBreakdown, cashFlowByMonth, fillMonths, monthBounds, recentMonths, type CashFlowMonth, type CashFlowShare } from "../lib/core/finance";
import { isoDate } from "../lib/core/dates";
import { loadCashFlowTransactions, loadCategories, type Category } from "../lib/finance-data";
import { moneyWhole } from "../lib/presentation/finance-format";
import { monthYear } from "../lib/presentation/format";
import type { TransactionFilters } from "../lib/presentation/transaction-view";
import { categoryLabel } from "./CategoryPicker";
import { FinanceEmpty, FinanceSection, useFinanceLoad, type FinancePageProps } from "./FinanceShared";

/** How far back the month picker goes. */
const HISTORY_MONTHS = 24;
const CHART_MONTHS = 12;
const shortMonth = new Intl.DateTimeFormat("en-US", { month: "short" });
const monthName = (month: string) => shortMonth.format(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 15));
const percent = (share: number) => `${Math.round(share * 100)}%`;

/** Round axis steps: 1, 2 or 5 times a power of ten, about four of them up to `max`. */
function niceTicks(max: number) {
  if (max <= 0) return [0];
  const rough = max / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((value) => value >= rough) ?? rough;
  const ticks = [];
  for (let value = 0; value < max + step; value += step) ticks.push(value);
  return ticks;
}

/** "$12K" on the axis once values reach $10,000; whole dollars below. */
function axisMoney(cents: number, top: number) {
  if (top < 1_000_000) return moneyWhole(cents);
  const thousands = cents / 100_000;
  return `$${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`;
}

/** Income vs spending per month: paired columns on one axis, a tooltip per month, click to pick it. */
function MonthChart({ months, selected, onSelect }: { months: CashFlowMonth[]; selected: string | null; onSelect: (month: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(...months.map((month) => Math.max(month.incomeCents, month.expenseCents)), 0);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const shown = months.find((month) => month.month === hover);
  const shownIndex = shown ? months.indexOf(shown) : -1;
  return (
    <figure className="cf-chart" aria-label="Income and spending by month">
      <div className="cf-legend" aria-hidden="true">
        <span><i className="cf-swatch income" /> Income</span>
        <span><i className="cf-swatch spend" /> Spending</span>
      </div>
      <div className="cf-plot">
        <div className="cf-axis" aria-hidden="true">
          {ticks.map((tick) => <span key={tick} className="num" style={{ bottom: `${(tick / top) * 100}%` }}>{axisMoney(tick, top)}</span>)}
        </div>
        <div className="cf-area">
          {ticks.map((tick) => <span key={tick} className={`cf-grid${tick === 0 ? " base" : ""}`} style={{ bottom: `${(tick / top) * 100}%` }} aria-hidden="true" />)}
          <div className="cf-columns" onPointerLeave={() => setHover(null)}>
            {months.map((month) => (
              <button
                key={month.month}
                type="button"
                className={`cf-month${month.month === selected ? " selected" : ""}`}
                aria-pressed={month.month === selected}
                aria-label={`${monthYear(`${month.month}-01`)}: income ${moneyWhole(month.incomeCents)}, spending ${moneyWhole(month.expenseCents)}, net ${moneyWhole(month.netCents)}`}
                onPointerEnter={() => setHover(month.month)}
                onFocus={() => setHover(month.month)}
                onBlur={() => setHover(null)}
                onClick={() => onSelect(month.month)}
              >
                <span className="cf-bars">
                  <span className="cf-bar income" style={{ height: `${(Math.max(month.incomeCents, 0) / top) * 100}%` }} />
                  <span className="cf-bar spend" style={{ height: `${(Math.max(month.expenseCents, 0) / top) * 100}%` }} />
                </span>
              </button>
            ))}
          </div>
          {shown && (
            <div className={`cf-tooltip${shownIndex > months.length / 2 ? " left" : ""}`} style={{ left: `${((shownIndex + (shownIndex > months.length / 2 ? 0 : 1)) / months.length) * 100}%` }} role="status">
              <strong>{monthYear(`${shown.month}-01`)}</strong>
              <span><i className="cf-key income" /><b className="num">{moneyWhole(shown.incomeCents)}</b> income</span>
              <span><i className="cf-key spend" /><b className="num">{moneyWhole(shown.expenseCents)}</b> spending</span>
              <span><i className="cf-key" /><b className="num">{moneyWhole(shown.netCents)}</b> net</span>
            </div>
          )}
        </div>
      </div>
      <div className="cf-labels" aria-hidden="true">
        {months.map((month, index) => <span key={month.month} className={month.month === selected ? "selected" : ""}>{index === 0 || month.month.endsWith("-01") ? `${monthName(month.month)} ’${month.month.slice(2, 4)}` : monthName(month.month)}</span>)}
      </div>
      <details className="cf-table">
        <summary>Show as table</summary>
        <table>
          <thead><tr><th>Month</th><th className="right">Income</th><th className="right">Spending</th><th className="right">Net</th></tr></thead>
          <tbody>
            {[...months].reverse().map((month) => (
              <tr key={month.month}><td>{monthYear(`${month.month}-01`)}</td><td className="num right">{moneyWhole(month.incomeCents)}</td><td className="num right">{moneyWhole(month.expenseCents)}</td><td className="num right">{moneyWhole(month.netCents)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** Sorted horizontal bars with amount and share; each row opens the matching transactions. */
function ShareBars({ rows, tone }: { rows: { key: string; label: string; cents: number; detail: string; open: () => void }[]; tone: "income" | "spend" }) {
  const max = Math.max(...rows.map((row) => row.cents), 1);
  return (
    <ul className="cf-bars-list">
      {rows.map((row) => (
        <li key={row.key}>
          <button type="button" className="cf-share" onClick={row.open} title="Show these transactions">
            <span className="cf-share-label">{row.label}</span>
            <span className="cf-share-value"><b className="num">{moneyWhole(row.cents)}</b> <span className="num">{row.detail}</span></span>
            <span className="cf-share-track" aria-hidden="true"><span className={`cf-share-bar ${tone}`} style={{ width: `${(row.cents / max) * 100}%` }} /></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Cash flow tab: income, spending and net for a month or the last 12, by month, category and merchant. */
export function CashFlowPage({ context, onOpenSettings, onShowTransactions }: FinancePageProps) {
  const today = isoDate(new Date());
  const months = useMemo(() => recentMonths(today, HISTORY_MONTHS), [today]);
  const load = useCallback(async () => {
    const [transactions, categories] = await Promise.all([loadCashFlowTransactions(context, `${months[0]}-01`, today), loadCategories(context)]);
    return { transactions, categories };
  }, [context, months, today]);
  const { data, error, reload } = useFinanceLoad(load);
  // A month (YYYY-MM) or the last 12 months.
  const [period, setPeriod] = useState<string>(() => today.slice(0, 7));

  const yearView = period === "12m";
  const chartEnd = yearView ? months.length - 1 : Math.max(months.indexOf(period), CHART_MONTHS - 1);
  const chartMonths = useMemo(() => months.slice(chartEnd - CHART_MONTHS + 1, chartEnd + 1), [months, chartEnd]);
  const range = yearView ? { from: `${chartMonths[0]}-01`, to: today } : monthBounds(period);
  const categoryById = useMemo(() => new Map((data?.categories || []).map((category: Category) => [category.id, category])), [data]);
  const byMonth = useMemo(() => (data ? fillMonths(cashFlowByMonth(data.transactions, data.categories), chartMonths) : []), [data, chartMonths]);
  const breakdown = useMemo(() => (data ? cashFlowBreakdown(data.transactions.filter((transaction) => transaction.date >= range.from && transaction.date <= range.to), data.categories, 10) : null), [data, range.from, range.to]);

  const show = (filters: Partial<TransactionFilters>) => onShowTransactions({ datePreset: "custom", from: range.from, to: range.to, ...filters });
  const shareRows = (rows: CashFlowShare[], direction: "in" | "out") => rows.map((row) => ({
    key: String(row.categoryId),
    label: categoryLabel(row.categoryId === null ? null : categoryById.get(row.categoryId)),
    cents: row.cents,
    detail: percent(row.share),
    open: () => show({ category: row.categoryId ?? "none", ...(row.categoryId === null && { direction }) }),
  }));
  const index = months.indexOf(period);
  const periodLabel = yearView ? "the last 12 months" : monthYear(`${period}-01`);

  const picker = (
    <div className="cf-period">
      <button type="button" className="btn small" aria-label="Previous month" disabled={yearView || index <= 0} onClick={() => setPeriod(months[index - 1])}>‹</button>
      <select aria-label="Period" value={period} onChange={(event) => setPeriod(event.target.value)}>
        <option value="12m">Last 12 months</option>
        {[...months].reverse().map((month) => <option key={month} value={month}>{monthYear(`${month}-01`)}</option>)}
      </select>
      <button type="button" className="btn small" aria-label="Next month" disabled={yearView || index >= months.length - 1} onClick={() => setPeriod(months[index + 1])}>›</button>
    </div>
  );

  return (
    <FinanceSection title="Cash flow" actions={picker} error={error} onRetry={() => void reload()}>
      {!data || !breakdown ? <p className="hint">Loading…</p> : data.transactions.length === 0 ? (
        <FinanceEmpty onOpenSettings={onOpenSettings}>No transactions in the last two years yet. Connect a bank or card in Settings to see your cash flow.</FinanceEmpty>
      ) : (
        <>
          <div className="cf-tiles">
            <div className="cf-tile"><span>Income</span><strong>{moneyWhole(breakdown.incomeCents)}</strong>{yearView && <small>{moneyWhole(Math.round(breakdown.incomeCents / CHART_MONTHS))} a month</small>}</div>
            <div className="cf-tile"><span>Spending</span><strong>{moneyWhole(breakdown.expenseCents)}</strong>{yearView && <small>{moneyWhole(Math.round(breakdown.expenseCents / CHART_MONTHS))} a month</small>}</div>
            <div className="cf-tile">
              <span>Net</span>
              <strong className={breakdown.netCents < 0 ? "negative" : ""}>{moneyWhole(breakdown.netCents)}</strong>
              <small>{breakdown.savingsRate === null ? "No income" : `${percent(breakdown.savingsRate)} saved`}</small>
            </div>
          </div>

          <section className="cf-card">
            <h3>By month</h3>
            <MonthChart months={byMonth} selected={yearView ? null : period} onSelect={setPeriod} />
          </section>

          <div className="cf-columns-2">
            <section className="cf-card">
              <h3>Spending by category <span className="sub">{periodLabel}</span></h3>
              {breakdown.spending.length ? <ShareBars tone="spend" rows={shareRows(breakdown.spending, "out")} /> : <p className="hint">No spending in {periodLabel}.</p>}
            </section>
            <div className="cf-stack">
              <section className="cf-card">
                <h3>Income by category <span className="sub">{periodLabel}</span></h3>
                {breakdown.income.length ? <ShareBars tone="income" rows={shareRows(breakdown.income, "in")} /> : <p className="hint">No income in {periodLabel}.</p>}
              </section>
              <section className="cf-card">
                <h3>Top merchants <span className="sub">{periodLabel}</span></h3>
                {breakdown.merchants.length ? (
                  <ShareBars tone="spend" rows={breakdown.merchants.map((merchant) => ({
                    key: merchant.merchant,
                    label: merchant.merchant,
                    cents: merchant.cents,
                    detail: `${merchant.count}×`,
                    open: () => show({ search: merchant.merchant }),
                  }))} />
                ) : <p className="hint">No spending in {periodLabel}.</p>}
              </section>
            </div>
          </div>
          <p className="hint">Transfers (like card payments) and excluded transactions don&apos;t count. Uncategorized money in counts as income and money out as spending; refunds reduce their category&apos;s spending. Tap a category or merchant to see its transactions.</p>
        </>
      )}
    </FinanceSection>
  );
}
