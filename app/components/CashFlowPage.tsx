"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  assignCategoryHues, CATEGORY_HUES, cashFlowBreakdown, cashFlowByMonth, cashFlowFlow, cashFlowPeriodRanges, cashFlowSide, chartWindowEnd, defaultCashFlowPeriod,
  elapsedMonths, fillMonths, foldShares, preferredCategoryHue, recentMonths, relativeChange, withPreviousShares, type CashFlowShare, type DateRange, type FlowNode, type MerchantSpend,
} from "../lib/core/finance";
import { isoDate } from "../lib/core/dates";
import { loadCashFlowTransactions, loadCategories, type Category } from "../lib/finance-data";
import { moneyWhole, percent } from "../lib/presentation/finance-format";
import { monthName, monthYear } from "../lib/presentation/format";
import type { TransactionFilters } from "../lib/presentation/transaction-view";
import { FlowDiagram, MonthChart, SegmentBar, type FlowItem } from "./CashFlowCharts";
import { FinanceEmpty, FinanceSection, useFinanceLoad, type FinancePageProps } from "./FinanceShared";
import { MerchantIcon } from "./MerchantIcon";

/** How far back the month picker goes (and what's loaded: 12 months plus the 12 before, for comparisons). */
const HISTORY_MONTHS = 24;
const CHART_MONTHS = 12;
/** Spending categories drawn in their own color before the rest fold into "Everything else". */
const COLORED_CATEGORIES = 7;

type CashFlowTxn = Awaited<ReturnType<typeof loadCashFlowTransactions>>[number];
export type CashFlowData = { transactions: CashFlowTxn[]; categories: Category[] };

const between = <T extends { date: string }>(transactions: T[], range: DateRange) => transactions.filter((transaction) => transaction.date >= range.from && transaction.date <= range.to);

/** Cash flow tab: loads two years of transactions and categories, then shows CashFlowView. */
export function CashFlowPage({ context, onOpenSettings, onShowTransactions }: FinancePageProps) {
  const today = isoDate(new Date());
  const load = useCallback(async () => {
    const [transactions, categories] = await Promise.all([loadCashFlowTransactions(context, `${recentMonths(today, HISTORY_MONTHS)[0]}-01`, today), loadCategories(context)]);
    return { transactions, categories };
  }, [context, today]);
  const { data, error, reload } = useFinanceLoad(load);
  return <CashFlowView data={data} error={error} onRetry={() => void reload()} today={today} onOpenSettings={onOpenSettings} onShowTransactions={onShowTransactions} />;
}

type Tone = "good" | "bad" | "flat";
type Change = { text: string; tone: Tone; vs: string } | null;

/** "▲ 12%" style change; `upIsGood` decides the tone. Under half a unit counts as no change. */
function change(diff: number, upIsGood: boolean, text: string, vs: string, flat: boolean): Change {
  if (flat) return { text: "No change", tone: "flat", vs };
  const up = diff > 0;
  return { text: `${up ? "▲" : "▼"} ${text}`, tone: up === upIsGood ? "good" : "bad", vs };
}

function ChangeNote({ value }: { value: Change }) {
  if (!value) return null;
  return <span className={`cf-change ${value.tone}`}><b>{value.text}</b> <span>{value.vs}</span></span>;
}

function Tile({ label, value, negative, note, children }: { label: string; value: string; negative?: boolean; note?: Change; children?: ReactNode }) {
  return (
    <div className="cf-tile">
      <span className="cf-tile-label">{label}</span>
      <strong className={`figure${negative ? " negative" : ""}`}>{value}</strong>
      {children}
      <ChangeNote value={note ?? null} />
    </div>
  );
}

/** Round icon: a merchant logo when there is one, else the emoji, on a tint of the row's color. */
function RowIcon({ emoji, color, logoUrl }: { emoji: string; color: string; logoUrl?: string | null }) {
  return <MerchantIcon className="cf-icon" logoUrl={logoUrl} emoji={emoji} style={{ background: `color-mix(in srgb, ${color} 16%, var(--surface))`, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 30%, transparent)` }} />;
}

type Row = { key: string; label: string; emoji: string; color: string; cents: number; share?: number; detail?: string; change?: Change; logoUrl?: string | null; open: () => void };

/** A ranked list: icon, name, a thin proportional bar in the row's color, the amount, share and change. */
function RankedRows({ rows, max }: { rows: Row[]; max: number }) {
  return (
    <ul className="cf-rows">
      {rows.map((row) => (
        <li key={row.key}>
          <button type="button" className="cf-row" onClick={row.open} title="Show these transactions">
            <RowIcon emoji={row.emoji} color={row.color} logoUrl={row.logoUrl} />
            <span className="cf-row-main">
              <span className="cf-row-name">{row.label}</span>
              <span className="cf-row-track" aria-hidden="true"><span style={{ width: `${Math.max((row.cents / Math.max(max, 1)) * 100, 1.5)}%`, background: row.color }} /></span>
            </span>
            <span className="cf-row-value">
              <b className="num">{moneyWhole(row.cents)}</b>
              <small>
                {row.share !== undefined && <span className="num">{percent(row.share)}</span>}
                {row.detail && <span>{row.detail}</span>}
                {row.change && <span className={`cf-change ${row.change.tone}`}><b>{row.change.text}</b></span>}
              </small>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function CardEmpty({ icon, children }: { icon: string; children: ReactNode }) {
  return <div className="cf-empty"><span aria-hidden="true">{icon}</span><p>{children}</p></div>;
}

function Card({ title, sub, aside, wide, children }: { title: string; sub?: string; aside?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`cf-card${wide ? " wide" : ""}`}>
      <header className="cf-card-head">
        <h3>{title}{sub && <span className="sub">{sub}</span>}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Skeleton() {
  return (
    <div className="cf-skeleton" aria-busy="true" aria-label="Loading cash flow">
      <div className="cf-tiles">{[0, 1, 2, 3].map((index) => <div key={index} className="cf-tile"><i className="cf-skel short" /><i className="cf-skel tall" /><i className="cf-skel" /></div>)}</div>
      <div className="cf-card"><i className="cf-skel short" /><i className="cf-skel block" /></div>
    </div>
  );
}

/**
 * The Cash flow page for already-loaded data: a period picker, summary tiles with changes, the
 * monthly chart, the income → spending flow, and category, income and merchant lists. Tapping a
 * category or merchant opens Transactions filtered to it.
 */
export function CashFlowView({ data, error, onRetry, today, onOpenSettings, onShowTransactions }: {
  data: CashFlowData | null;
  error?: string;
  onRetry?: () => void;
  today: string;
  onOpenSettings: () => void;
  onShowTransactions: (filters: Partial<TransactionFilters>) => void;
}) {
  const months = useMemo(() => recentMonths(today, HISTORY_MONTHS), [today]);
  const firstLoaded = `${months[0]}-01`;
  const kinds = useMemo(() => new Map((data?.categories || []).map((category) => [category.id, category.kind])), [data]);
  const categoryById = useMemo(() => new Map((data?.categories || []).map((category) => [category.id, category])), [data]);
  const thisMonth = today.slice(0, 7);
  const autoMonth = useMemo(() => defaultCashFlowPeriod(today, (data?.transactions || []).filter((transaction) => transaction.date.startsWith(thisMonth) && cashFlowSide(transaction, kinds)).length), [data, kinds, today, thisMonth]);
  // A month (YYYY-MM) or "12m"; null until the person picks one (then the default applies).
  const [chosen, setChosen] = useState<string | null>(null);
  const [lastMonth, setLastMonth] = useState<string | null>(null);
  // The chart's 12-month window (index of its last month): it only moves when the picked month is
  // outside it, so clicking a bar highlights it instead of shifting every bar. Null = the newest 12.
  const [windowEnd, setWindowEnd] = useState<number | null>(null);
  const period = chosen ?? autoMonth;
  const yearView = period === "12m";
  const month = yearView ? lastMonth ?? autoMonth : period;
  const pick = (value: string) => {
    if (value !== "12m") setLastMonth(value);
    setChosen(value);
    setWindowEnd(value === "12m" ? null : chartWindowEnd(chartEnd, months.indexOf(value), CHART_MONTHS, months.length));
  };

  const ranges = useMemo(() => cashFlowPeriodRanges(period, today), [period, today]);
  const comparable = ranges.previousRange.from >= firstLoaded;
  // A month under way is compared with the same days of the month before ("vs Oct 1–3").
  const vs = yearView ? "vs the 12 months before"
    : `vs ${monthName(ranges.previousMonth || month)}${ranges.partial ? ` 1–${Number(ranges.previousRange.to.slice(8))}` : ""}`;
  const index = months.indexOf(month);
  const chartEnd = yearView ? months.length - 1 : chartWindowEnd(windowEnd ?? months.length - 1, index, CHART_MONTHS, months.length);
  const chartMonths = useMemo(() => months.slice(Math.max(chartEnd - CHART_MONTHS + 1, 0), chartEnd + 1), [months, chartEnd]);

  const byMonth = useMemo(() => (data ? fillMonths(cashFlowByMonth(data.transactions, data.categories), chartMonths) : []), [data, chartMonths]);
  const breakdown = useMemo(() => (data ? cashFlowBreakdown(between(data.transactions, ranges.range), data.categories, 8) : null), [data, ranges]);
  const previous = useMemo(() => (data && comparable ? cashFlowBreakdown(between(data.transactions, ranges.previousRange), data.categories, 0) : null), [data, ranges, comparable]);

  // Colors: a category's own color wins; the rest get palette hues by size, so no two shown ones match.
  // A lone extra category is shown as itself (not as "Everything else (1)") only while the palette
  // still has a hue for it; otherwise it would be the same gray as "Everything else", so it folds.
  const { hues, loneLeftover } = useMemo(() => {
    const wantsHue = (breakdown?.spending || []).slice(0, COLORED_CATEGORIES + 1)
      .map((row) => (row.categoryId === null ? undefined : categoryById.get(row.categoryId)))
      .filter((category): category is Category => Boolean(category && !category.color && preferredCategoryHue(category) !== null));
    return { hues: assignCategoryHues(wantsHue), loneLeftover: wantsHue.length <= CATEGORY_HUES };
  }, [breakdown, categoryById]);
  const colorOf = (categoryId: number | null) => {
    const category = categoryId === null ? undefined : categoryById.get(categoryId);
    if (category?.color) return category.color;
    const hue = categoryId === null ? undefined : hues.get(categoryId);
    return hue === undefined ? "var(--cat-none)" : `var(--cat-${hue})`;
  };
  const nameOf = (categoryId: number | null) => (categoryId === null ? "Uncategorized" : categoryById.get(categoryId)?.name || "Unknown category");
  const emojiOf = (categoryId: number | null, fallback = "📦") => (categoryId === null ? "❔" : categoryById.get(categoryId)?.emoji || fallback);

  const periodLabel = yearView ? "Last 12 months" : monthYear(`${period}-01`);
  const show = (filters: Partial<TransactionFilters>) => onShowTransactions({ datePreset: "custom", from: ranges.range.from, to: ranges.range.to, ...filters });
  const openCategory = (categoryId: number | null, direction: "in" | "out") => show({ category: categoryId ?? "none", ...(categoryId === null && { direction }) });

  const picker = (
    <div className="cf-period">
      <div className="seg" role="group" aria-label="Period length">
        <button type="button" aria-pressed={!yearView} onClick={() => pick(month)}>Month</button>
        <button type="button" aria-pressed={yearView} onClick={() => pick("12m")}>12 months</button>
      </div>
      {/* Hidden, not removed, in the 12-month view so the header keeps its size. */}
      <div className={`cf-stepper${yearView ? " hidden" : ""}`} aria-hidden={yearView || undefined}>
        <button type="button" className="btn icon-btn" aria-label="Previous month" disabled={yearView || index <= 0} onClick={() => pick(months[index - 1])}>‹</button>
        <select aria-label="Month" value={month} disabled={yearView} onChange={(event) => pick(event.target.value)}>
          {[...months].reverse().map((value) => <option key={value} value={value}>{monthYear(`${value}-01`)}{value === thisMonth ? " (so far)" : ""}</option>)}
        </select>
        <button type="button" className="btn icon-btn" aria-label="Next month" disabled={yearView || index >= months.length - 1} onClick={() => pick(months[index + 1])}>›</button>
      </div>
    </div>
  );

  if (!data || !breakdown) {
    return <FinanceSection title="Cash flow" actions={picker} error={error} onRetry={onRetry}>{!error && <Skeleton />}</FinanceSection>;
  }
  if (data.transactions.length === 0) {
    return (
      <FinanceSection title="Cash flow" error={error} onRetry={onRetry}>
        <FinanceEmpty onOpenSettings={onOpenSettings}>No transactions in the last two years yet. Connect a bank or card in Settings to see your cash flow.</FinanceEmpty>
      </FinanceSection>
    );
  }

  const tiny = (value: number) => Math.abs(value) < 0.005;
  const rate = breakdown.savingsRate;
  const previousRate = previous?.savingsRate ?? null;
  const incomeChange = previous && relativeChange(breakdown.incomeCents, previous.incomeCents);
  const spendChange = previous && relativeChange(breakdown.expenseCents, previous.expenseCents);
  const netDiff = previous ? breakdown.netCents - previous.netCents : null;
  const rateDiff = rate !== null && previousRate !== null ? Math.round((rate - previousRate) * 100) : null;
  // "A month" over the last 12: this month counts only for the part of it that's gone by.
  const perMonth = (cents: number) => (yearView ? <small className="cf-tile-sub">{moneyWhole(Math.round(cents / elapsedMonths(today, ranges.months)))} a month</small> : null);

  // Flow diagram: income sources → spending categories and savings.
  const flow = cashFlowFlow(breakdown, { incomeNodes: 3, spendingNodes: COLORED_CATEGORIES, spendingLoneLeftover: loneLeftover });
  const flowItem = (node: FlowNode): FlowItem => {
    if (node.role === "income") return { key: node.key, label: nameOf(node.categoryId), emoji: emojiOf(node.categoryId, "💰"), cents: node.cents, color: "var(--cf-income)", onOpen: () => openCategory(node.categoryId, "in") };
    if (node.role === "other-income") return { key: node.key, label: `${node.count} more sources`, emoji: "💰", cents: node.cents, color: "var(--cf-income)" };
    if (node.role === "deficit") return { key: node.key, label: "From savings", emoji: "🔻", cents: node.cents, color: "var(--cat-none)" };
    if (node.role === "savings") return { key: node.key, label: "Saved", emoji: "🌱", cents: node.cents, color: "var(--cf-income)" };
    if (node.role === "refunds") return { key: node.key, label: "Refunds", emoji: "↩️", cents: node.cents, color: "var(--cat-none)" };
    if (node.role === "reversals") return { key: node.key, label: "Income reversed", emoji: "↩️", cents: node.cents, color: "var(--cat-none)" };
    if (node.role === "other-spending") return { key: node.key, label: `Everything else (${node.count})`, emoji: "🗂️", cents: node.cents, color: "var(--cat-none)" };
    return { key: node.key, label: nameOf(node.categoryId), emoji: emojiOf(node.categoryId), cents: node.cents, color: colorOf(node.categoryId), onOpen: () => openCategory(node.categoryId, "out") };
  };

  // Spending by category: colored top categories, then the rest in neutral gray behind a toggle.
  const spending = withPreviousShares(breakdown.spending, previous?.spending || []);
  const folded = foldShares(spending, COLORED_CATEGORIES, { loneLeftover });
  const shareChange = (row: { cents: number; previousCents: number }, upIsGood: boolean): Change => {
    if (!previous) return null;
    if (row.previousCents <= 0) return { text: "New", tone: "flat", vs };
    const diff = row.cents - row.previousCents;
    return change(diff, upIsGood, moneyWhole(Math.abs(diff)), vs, Math.abs(diff) < 100);
  };
  const categoryRow = (row: CashFlowShare & { previousCents: number }, direction: "in" | "out", color: string): Row => ({
    key: String(row.categoryId),
    label: nameOf(row.categoryId),
    emoji: emojiOf(row.categoryId, direction === "in" ? "💰" : "📦"),
    color,
    cents: row.cents,
    share: row.share,
    change: shareChange(row, direction === "in"),
    open: () => openCategory(row.categoryId, direction),
  });
  const segments = [
    ...folded.shown.map((row) => ({ key: String(row.categoryId), label: nameOf(row.categoryId), cents: row.cents, share: row.share, color: colorOf(row.categoryId) })),
    ...(folded.rest.length ? [{ key: "rest", label: `Everything else (${folded.rest.length})`, cents: folded.restCents, share: folded.restShare, color: "var(--cat-none)" }] : []),
  ];
  const income = withPreviousShares(breakdown.income, previous?.income || []);
  const merchantRow = (merchant: MerchantSpend): Row => ({
    key: merchant.merchant,
    label: merchant.merchant,
    emoji: emojiOf(merchant.categoryId),
    color: colorOf(merchant.categoryId),
    cents: merchant.cents,
    detail: `${merchant.count} ${merchant.count === 1 ? "purchase" : "purchases"}`,
    logoUrl: merchant.logoUrl,
    open: () => show({ search: merchant.merchant }),
  });

  return (
    <FinanceSection title="Cash flow" actions={picker} error={error} onRetry={onRetry}>
      <div className="cf-tiles">
        <Tile label="Income" value={moneyWhole(breakdown.incomeCents)} note={incomeChange == null ? null : change(incomeChange, true, percent(Math.abs(incomeChange)), vs, tiny(incomeChange))}>{perMonth(breakdown.incomeCents)}</Tile>
        <Tile label="Spending" value={moneyWhole(breakdown.expenseCents)} note={spendChange == null ? null : change(spendChange, false, percent(Math.abs(spendChange)), vs, tiny(spendChange))}>{perMonth(breakdown.expenseCents)}</Tile>
        <Tile label="Net savings" value={moneyWhole(breakdown.netCents)} negative={breakdown.netCents < 0} note={netDiff === null ? null : change(netDiff, true, moneyWhole(Math.abs(netDiff)), vs, Math.abs(netDiff) < 100)}>{perMonth(breakdown.netCents)}</Tile>
        <Tile label="Savings rate" value={rate === null ? "—" : percent(rate)} negative={rate !== null && rate < 0} note={rateDiff === null ? null : change(rateDiff, true, `${Math.abs(rateDiff)} ${Math.abs(rateDiff) === 1 ? "pt" : "pts"}`, vs, rateDiff === 0)}>
          {rate === null ? <small className="cf-tile-sub">No income</small> : <span className="cf-meter" aria-hidden="true"><span style={{ width: `${Math.min(Math.max(rate, 0), 1) * 100}%` }} /></span>}
        </Tile>
      </div>

      <Card title="Income & spending" sub={`${monthYear(`${chartMonths[0]}-01`)} – ${monthYear(`${chartMonths[chartMonths.length - 1]}-01`)}`} wide
        aside={!yearView && month === thisMonth ? <span className="cf-pill">{monthName(thisMonth, "long")} so far</span> : undefined}>
        <MonthChart months={byMonth} selected={yearView ? null : period} onSelect={pick} />
      </Card>

      <Card title="Where the money went" sub={periodLabel} wide>
        {flow.totalCents > 0 ? (
          <FlowDiagram sources={flow.sources.map(flowItem)} targets={flow.targets.map(flowItem)} totalCents={flow.totalCents}
            centerLabel={flow.refundCents + flow.reversalCents > 0 ? (flow.incomeCents >= flow.spendingCents ? "Money in" : "Money out") : flow.incomeCents >= flow.spendingCents ? "Income" : "Spending"}
            centerNote={flow.spendingCents > flow.incomeCents ? `${moneyWhole(flow.spendingCents - flow.incomeCents)} more than came in` : undefined} />
        ) : <CardEmpty icon="🌤️">Nothing came in or went out in {periodLabel}.</CardEmpty>}
      </Card>

      <div className="cf-columns-2">
        <Card title="Spending by category" sub={periodLabel} aside={<b className="figure cf-card-total">{moneyWhole(breakdown.expenseCents)}</b>}>
          {spending.length ? (
            <>
              <SegmentBar segments={segments} label="Share of spending" />
              <RankedRows max={spending[0].cents} rows={folded.shown.map((row) => categoryRow(row, "out", colorOf(row.categoryId)))} />
              {folded.rest.length > 0 && (
                <details className="cf-more">
                  <summary>Everything else · {folded.rest.length} {folded.rest.length === 1 ? "category" : "categories"} · <span className="num">{moneyWhole(folded.restCents)}</span></summary>
                  <RankedRows max={spending[0].cents} rows={folded.rest.map((row) => categoryRow(row, "out", "var(--cat-none)"))} />
                </details>
              )}
              {breakdown.refundCents > 0 && <p className="cf-card-note">Refunds in categories with no other spending (like a return of an earlier purchase) take <span className="num">{moneyWhole(breakdown.refundCents)}</span> off the total.</p>}
            </>
          ) : <CardEmpty icon="🧾">No spending in {periodLabel}.</CardEmpty>}
        </Card>
        <div className="cf-stack">
          <Card title="Income" sub={periodLabel} aside={<b className="figure cf-card-total">{moneyWhole(breakdown.incomeCents)}</b>}>
            {income.length ? <RankedRows max={income[0].cents} rows={income.map((row) => categoryRow(row, "in", "var(--cf-income)"))} /> : <CardEmpty icon="💼">No income in {periodLabel}.</CardEmpty>}
            {breakdown.reversalCents > 0 && <p className="cf-card-note">Reversed income in categories with nothing else coming in takes <span className="num">{moneyWhole(breakdown.reversalCents)}</span> off the total.</p>}
          </Card>
          <Card title="Top merchants" sub={periodLabel}>
            {breakdown.merchants.length ? <RankedRows max={breakdown.merchants[0].cents} rows={breakdown.merchants.map(merchantRow)} /> : <CardEmpty icon="🛍️">No purchases in {periodLabel}.</CardEmpty>}
          </Card>
        </div>
      </div>
      <p className="hint">Transfers (like card payments) and excluded transactions don&apos;t count. Uncategorized money in counts as income and money out as spending; refunds reduce their category&apos;s spending. Changes compare with {yearView ? "the 12 months before" : "the month before"}{ranges.partial ? ", up to the same day" : ""}. Tap a category or merchant to see its transactions.</p>
    </FinanceSection>
  );
}
