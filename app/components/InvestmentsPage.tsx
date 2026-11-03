"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import { isoDate } from "../lib/core/dates";
import {
  ACTIVITY_KINDS, activityKind, aggregatePositions, allocationByAccount, allocationByClass, ASSET_CLASSES, balanceSeries, INVESTMENT_MANUAL_KINDS,
  periodChange, rangeStart, seriesFrom, snapshotKey, snapshotLoadStart, sortPositions, summarizePositions, withLiveEnd,
  type ActivityKind, type PositionSort, type Range,
} from "../lib/core/investments";
import {
  loadBalanceSnapshots, loadBankAccounts, loadHoldings, loadInvestmentTransactions, loadManualAccounts, loadSecurities, MANUAL_ACCOUNT_KINDS,
  type InvestmentTransaction,
} from "../lib/finance-data";
import { bankAccountLabel } from "../lib/presentation/account-labels";
import { moneyExact, moneyWhole, percent, signedMoney, signedPercent, transactionAmount } from "../lib/presentation/finance-format";
import { fullDate, shortDate } from "../lib/presentation/format";
import { AccountName, bankAccountOwner, bankBalanceCents, OwnerButtons, RangeButtons, type OwnerFilter } from "./FinanceAccounts";
import { BarList, Change, LineChart } from "./FinanceChart";
import { FinanceEmpty, FinanceLoading, FinanceSection, useFinanceLoad, type FinancePageProps } from "./FinanceShared";
import { errorText } from "../lib/api";

const ACTIVITY_PAGE = 200;
const classLabel = (value: string) => ASSET_CLASSES.find((item) => item.value === value)?.label ?? value;
const activityLabel = (value: ActivityKind) => ACTIVITY_KINDS.find((item) => item.value === value)?.one ?? value;
const quantityText = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 4 });
const priceText = (dollars: number) => moneyExact(Math.round(dollars * 100));

/** One investment account: a Plaid investment account or a manual one (e.g. Edgar Street Capital). */
type InvestmentAccount = { key: string; name: string; fullName: string; ownerId: number | null; plaidAccountId: number | null; manualAccountId: number | null };

/** Investments tab: value, cost basis and gains, allocation, holdings by security, value over time and activity. */
export function InvestmentsPage({ context, portfolio, notify, onOpenSettings }: FinancePageProps) {
  const today = isoDate(new Date());
  const [range, setRange] = useState<Range>("1Y");
  const load = useCallback(async () => {
    const [holdings, bank, manual, activity, securities] = await Promise.all([
      loadHoldings(context), loadBankAccounts(context), loadManualAccounts(context),
      loadInvestmentTransactions(context, { limit: ACTIVITY_PAGE }), loadSecurities(context),
    ]);
    return { holdings, bank, manual, activity, securities };
  }, [context]);
  const { data, error: positionsError, reload: reloadPositions } = useFinanceLoad(load);
  // Only the history the chosen range needs (there's a row per account per day); the old range shows until it arrives.
  const loadHistory = useCallback(() => loadBalanceSnapshots(context, snapshotLoadStart(today, range)), [context, today, range]);
  const { data: snapshots, error: historyError, reload: reloadHistory } = useFinanceLoad(loadHistory);
  const error = positionsError || historyError;
  const reload = useCallback(async () => { await Promise.all([reloadPositions(), reloadHistory()]); }, [reloadPositions, reloadHistory]);
  const [owner, setOwner] = useState<OwnerFilter>(null);
  const [accountKey, setAccountKey] = useState("all");
  const [sort, setSort] = useState<PositionSort>("value");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activityType, setActivityType] = useState<ActivityKind | "all">("all");
  const [shown, setShown] = useState(25);
  // Older activity pages, loaded after `base` (the first page they continue). A reload (Retry) brings a
  // new first page, so the extra pages and the count shown start over.
  const [more, setMore] = useState<{ base: typeof data; rows: InvestmentTransaction[]; done: boolean }>({ base: data, rows: [], done: false });
  if (more.base !== data) { setMore({ base: data, rows: [], done: false }); setShown(25); }
  const [loadingMore, setLoadingMore] = useState(false);

  const accounts = useMemo<InvestmentAccount[]>(() => {
    if (!data) return [];
    const withHoldings = new Set(data.holdings.map((holding) => holding.plaidAccountId));
    return [
      ...data.bank.filter((account) => account.type === "investment" || withHoldings.has(account.id))
        .map((account) => ({ key: `p${account.id}`, name: bankAccountLabel(account, portfolio), fullName: bankAccountLabel(account, portfolio, { full: true }), ownerId: bankAccountOwner(portfolio, account), plaidAccountId: account.id, manualAccountId: null })),
      ...data.manual.filter((account) => !account.archived && !account.liability && INVESTMENT_MANUAL_KINDS.has(account.kind))
        .map((account) => ({ key: `m${account.id}`, name: account.name, fullName: account.name, ownerId: account.personId, plaidAccountId: null, manualAccountId: account.id })),
    ];
  }, [data, portfolio]);
  const accountName = useMemo(() => new Map(accounts.map((account) => [account.key, account.name])), [accounts]);
  const ownerAccounts = accounts.filter((account) => owner === null || account.ownerId === owner);
  const chosen = useMemo(() => {
    const keys = accounts.filter((account) => (owner === null || account.ownerId === owner) && (accountKey === "all" || account.key === accountKey)).map((account) => account.key);
    return new Set(keys);
  }, [accounts, owner, accountKey]);

  const view = useMemo(() => {
    if (!data) return null;
    const holdings = data.holdings.filter((holding) => chosen.has(`p${holding.plaidAccountId}`));
    const withHoldings = new Set(holdings.map((holding) => holding.plaidAccountId));
    const manual = data.manual.filter((account) => chosen.has(`m${account.id}`)).map((account) => ({ id: account.id, name: account.name, kind: account.kind, balanceCents: account.balanceCents }));
    // A connected investment account with a balance but no holdings counts as one position.
    const bare = data.bank.flatMap((account) => {
      const balanceCents = bankBalanceCents(account);
      return chosen.has(`p${account.id}`) && !withHoldings.has(account.id) && balanceCents !== null ? [{ plaidAccountId: account.id, name: bankAccountLabel(account, portfolio), balanceCents }] : [];
    });
    const positions = aggregatePositions(holdings, manual, bare);
    const summary = summarizePositions(positions);
    const start = rangeStart(today, range);
    const loaded = snapshots ? balanceSeries(snapshots, (snapshot) => chosen.has(snapshotKey(snapshot))) : [];
    // End on today's live value so the chart, the change and the headline agree.
    const points = withLiveEnd(seriesFrom(loaded, start), today, summary.valueCents);
    // When the history is shorter than the range, say where it starts.
    const firstDate = loaded.length && (!start || loaded[0].date > start) ? loaded[0].date : null;
    return { positions, summary, byClass: allocationByClass(positions), byAccount: allocationByAccount(positions), points, firstDate };
  }, [data, snapshots, chosen, portfolio, range, today]);

  const activity = useMemo(() => {
    if (!data) return [];
    const seen = new Set<number>();
    return [...data.activity, ...more.rows]
      .filter((row) => !seen.has(row.id) && Boolean(seen.add(row.id)))
      .filter((row) => chosen.has(`p${row.plaidAccountId}`))
      .map((row) => ({ ...row, kind: activityKind(row.type, row.subtype) }))
      .filter((row) => activityType === "all" || row.kind === activityType);
  }, [data, more.rows, chosen, activityType]);
  const lastActivity = more.rows.at(-1) ?? data?.activity.at(-1);
  const canLoadMore = !more.done && (data?.activity.length ?? 0) === ACTIVITY_PAGE;

  const showMore = async () => {
    if (shown < activity.length) { setShown(shown + 25); return; }
    if (!canLoadMore || !lastActivity) return;
    const base = data;
    setLoadingMore(true);
    try {
      const rows = await loadInvestmentTransactions(context, { limit: ACTIVITY_PAGE, before: { date: lastActivity.date, id: lastActivity.id } });
      // Dropped if the first page was reloaded meanwhile (it would continue the old one).
      setMore((current) => (current.base === base ? { base, rows: [...current.rows, ...rows], done: rows.length < ACTIVITY_PAGE } : current));
      setShown((count) => count + 25);
    } catch (reason) { notify(errorText(reason, "Couldn't load more activity."), true); }
    finally { setLoadingMore(false); }
  };

  const toggle = (key: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const change = view ? periodChange(view.points) : null;
  const sorted = view ? sortPositions(view.positions, sort) : [];
  const nameOf = (account: { plaidAccountId: number | null; manualAccountId: number | null }) => accountName.get(snapshotKey(account)) ?? "Account";

  return (
    <FinanceSection title="Investments" error={error} onRetry={() => void reload()}>
      {!data || !view ? <FinanceLoading error={error} /> : accounts.length === 0 ? (
        <FinanceEmpty onOpenSettings={onOpenSettings}>No investments yet. Connect a brokerage or retirement account with &ldquo;Connect investments&rdquo;, or add a private holding on the Accounts tab (&ldquo;Add a manual account&rdquo;, kind Private investment).</FinanceEmpty>
      ) : (
        <>
          <div className="finance-filters">
            <OwnerButtons people={portfolio.people} value={owner} onChange={(value) => { setOwner(value); setAccountKey("all"); }} />
            <select className="filter-select" aria-label="Account" value={accountKey} onChange={(event) => setAccountKey(event.target.value)}>
              <option value="all">All accounts</option>
              {ownerAccounts.map((account) => <option key={account.key} value={account.key}>{account.fullName}</option>)}
            </select>
            <RangeButtons value={range} onChange={setRange} />
          </div>

          <div className="finance-card">
            <div className="stat-row">
              <div className="stat hero">
                <span className="stat-label">Total value</span>
                <span className="stat-value">{moneyWhole(view.summary.valueCents)}</span>
                {change && view.points.length > 1 && <span className="stat-delta"><Change cents={change.changeCents} percent={change.percent} /> since {fullDate(change.startDate)}</span>}
              </div>
              <div className="stat"><span className="stat-label">Cost basis</span><span className="stat-value">{moneyWhole(view.summary.costBasisCents)}</span></div>
              <div className="stat">
                <span className="stat-label">Unrealized gain</span>
                <span className="stat-value"><Change cents={view.summary.gainCents} /></span>
                {view.summary.gainPercent !== null && <span className="stat-delta">{signedPercent(view.summary.gainPercent)} on cost</span>}
              </div>
            </div>
            {view.summary.withoutCostBasis > 0 && (
              <p className="hint">{view.summary.withoutCostBasis} position{view.summary.withoutCostBasis === 1 ? "" : "s"} ({moneyWhole(view.summary.valueWithoutCostBasisCents)}) without a cost basis {view.summary.withoutCostBasis === 1 ? "is" : "are"} left out of the cost basis and gain.</p>
            )}
            <LineChart points={view.points} label="Investment value" emptyText="Value history starts the day an investment account is connected (or a manual value is saved); a point is added every day." />
            <p className="hint">{view.firstDate ? `History from ${fullDate(view.firstDate)}, when the first of these accounts was connected; earlier values aren't available from the bank. ` : ""}Includes cash held in the accounts.</p>
          </div>

          <div className="finance-split">
            <section className="finance-card" aria-label="Allocation by type">
              <h3 className="card-title">By type</h3>
              <BarList label="Allocation by type" items={view.byClass.map((slice) => ({ ...slice, label: classLabel(slice.key) }))} />
            </section>
            <section className="finance-card" aria-label="Allocation by account">
              <h3 className="card-title">By account</h3>
              <BarList label="Allocation by account" items={view.byAccount.map((slice) => ({ ...slice, label: accountName.get(slice.key) ?? "Account" }))} />
            </section>
          </div>

          <section className="group" aria-label="Holdings">
            <div className="group-head static">
              <h3>Holdings</h3>
              <span className="meta">{view.positions.length}</span>
              <div className="seg group-total" role="group" aria-label="Sort holdings">
                {([["value", "Value"], ["gain", "Gain"], ["gainPercent", "Gain %"]] as [PositionSort, string][]).map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={sort === value} onClick={() => setSort(value)}>{label}</button>
                ))}
              </div>
            </div>
            {sorted.length === 0 ? <p className="hint pad">No holdings in these accounts.</p> : (
              <div className="table-wrap">
                <table className="holdings-table">
                  <thead>
                    <tr>
                      <th className="sticky">Security</th>
                      <th className="r">Quantity</th>
                      <th className="r">Price</th>
                      <th className="r">Value</th>
                      <th className="r">Cost basis</th>
                      <th className="r">Gain</th>
                      <th className="r">Portfolio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((position) => {
                      // Only positions held in more than one account expand to a row per account.
                      const several = position.accounts.length > 1;
                      const open = several && expanded.has(position.key);
                      const onlyAccount = several ? null : nameOf(position.accounts[0]);
                      const label = (
                        <span className="holding-name">
                          <strong>{position.ticker || position.name}</strong>
                          {position.ticker && <span className="sub">{position.name}</span>}
                          <span className="sub">{classLabel(position.assetClass)}{several ? ` · ${position.accounts.length} accounts` : onlyAccount !== position.name ? <> · <AccountName label={onlyAccount!} /></> : ""}</span>
                        </span>
                      );
                      return (
                        <Fragment key={position.key}>
                          <tr>
                            <td className="sticky">
                              {several ? (
                                <button type="button" className="holding-toggle" aria-expanded={open} title="Show each account" onClick={() => toggle(position.key)}>
                                  <span className="caret" aria-hidden="true">›</span>{label}
                                </button>
                              ) : <span className="holding-toggle"><span className="caret" aria-hidden="true" />{label}</span>}
                            </td>
                            <td className="num r">{position.quantity === null ? "—" : quantityText(position.quantity)}</td>
                            <td className="num r">{position.price === null ? "—" : priceText(position.price)}</td>
                            <td className="num r strong">{moneyWhole(position.valueCents)}</td>
                            <td className="num r">{position.costBasisCents === null ? "—" : moneyWhole(position.costBasisCents)}</td>
                            <td className="num r">{position.gainCents === null ? "—" : <Change cents={position.gainCents} percent={position.gainPercent} />}</td>
                            <td className="num r">{percent(position.share)}</td>
                          </tr>
                          {open && position.accounts.map((account) => (
                            <tr key={account.key} className="sub-row">
                              <td className="sticky"><span className="holding-account"><AccountName label={nameOf(account)} /></span></td>
                              <td className="num r">{account.quantity === null ? "—" : quantityText(account.quantity)}</td>
                              <td />
                              <td className="num r">{moneyWhole(account.valueCents)}</td>
                              <td className="num r">{account.costBasisCents === null ? "—" : moneyWhole(account.costBasisCents)}</td>
                              <td className="num r">{account.gainCents === null ? "—" : signedMoney(account.gainCents)}</td>
                              <td className="num r">{view.summary.valueCents > 0 ? percent(account.valueCents / view.summary.valueCents) : "—"}</td>
                            </tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="group" aria-label="Recent activity">
            <div className="group-head static">
              <h3>Recent activity</h3>
              <select className="filter-select group-total" aria-label="Activity type" value={activityType} onChange={(event) => { setActivityType(event.target.value as ActivityKind | "all"); setShown(25); }}>
                <option value="all">All types</option>
                {ACTIVITY_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
              </select>
            </div>
            {activity.length === 0 ? <p className="hint pad">{canLoadMore ? "Nothing of this type in the latest activity." : "No activity of this type in the last 24 months."}</p> : (
              <ul className="finance-list flush">
                {activity.slice(0, shown).map((row) => {
                  const security = row.securityId !== null ? data.securities.get(row.securityId) : undefined;
                  const before = activityLabel(row.kind);
                  const after = [
                    security?.tickerSymbol,
                    row.quantity ? `${quantityText(Math.abs(row.quantity))}${row.price ? ` @ ${priceText(row.price)}` : ""}` : null,
                  ].filter(Boolean).join(" · ");
                  return (
                    <li key={row.id} className="finance-row">
                      <span className="when">{shortDate(row.date)}{row.date.slice(0, 4) !== today.slice(0, 4) && <small>{row.date.slice(0, 4)}</small>}</span>
                      <span className="grow">{row.name}<small>{before} · <AccountName label={nameOf({ plaidAccountId: row.plaidAccountId, manualAccountId: null })} />{after ? ` · ${after}` : ""}</small></span>
                      <span className={`num amount${row.amountCents > 0 ? " in" : ""}`}>{transactionAmount(row.amountCents)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {(shown < activity.length || canLoadMore) && (
              <div className="pad"><button type="button" className="btn small" disabled={loadingMore} onClick={() => void showMore()}>{loadingMore ? "Loading…" : "Show more"}</button></div>
            )}
          </section>
          <p className="hint">Manual investments ({MANUAL_ACCOUNT_KINDS.filter((kind) => INVESTMENT_MANUAL_KINDS.has(kind.value)).map((kind) => kind.label.toLowerCase()).join(", ")}) count as one position each; edit their value on the Accounts tab.</p>
        </>
      )}
    </FinanceSection>
  );
}
