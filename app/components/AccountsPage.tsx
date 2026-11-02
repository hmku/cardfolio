"use client";

import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { daysBetween, isoDate, parseDate } from "../lib/core/dates";
import { netWorthCents } from "../lib/core/finance";
import {
  ACCOUNT_GROUPS, balanceSeries, manualAccountGroup, periodChange, plaidAccountGroup, rangeStart, seriesFrom, snapshotKey, snapshotLoadStart, withLiveEnd,
  type AccountGroup, type Range, type SeriesPoint,
} from "../lib/core/investments";
import type { Portfolio } from "../lib/core/model";
import {
  deleteManualAccount, isDebt, loadBalanceSnapshots, loadBankAccounts, loadBankLogins, loadManualAccounts, MANUAL_ACCOUNT_KINDS,
  saveManualAccount, setBankAccountOwner, type BankAccount, type BankLogin, type FinanceContext, type ManualAccount, type ManualAccountKind,
} from "../lib/finance-data";
import { bankAccountLabel } from "../lib/presentation/account-labels";
import { moneyExact, moneyWhole } from "../lib/presentation/finance-format";
import { fullDate, shortDate, syncedAt, toCents, toDollarsInput } from "../lib/presentation/format";
import { AccountName, bankAccountKind, bankAccountOwner, bankBalanceCents, OwnerButtons, OwnerSelect, RangeButtons, type OwnerFilter } from "./FinanceAccounts";
import { Change, LineChart } from "./FinanceChart";
import { FinanceEmpty, FinanceLoading, FinanceSection, useFinanceLoad, type FinancePageProps } from "./FinanceShared";
import { ConfirmButton, Drawer, Tag } from "./ui";

/** One row on the Accounts page: a Plaid account or a manual one. */
type Row = {
  key: string;
  group: AccountGroup;
  name: string;
  ownerId: number | null;
  /** Contribution to net worth (debts negative), or null when the bank hasn't reported one. */
  balanceCents: number | null;
  plaid?: BankAccount;
  manual?: ManualAccount;
};

type Selected = { kind: "plaid"; id: number } | { kind: "manual"; id: number | null } | null;

const kindLabel = (kind: string) => MANUAL_ACCOUNT_KINDS.find((item) => item.value === kind)?.label ?? kind;

function toRows(portfolio: Portfolio, bank: BankAccount[], manual: ManualAccount[]): Row[] {
  return [
    ...bank.map((account) => {
      const balance = bankBalanceCents(account);
      return { key: `p${account.id}`, group: plaidAccountGroup(account.type, account.subtype), name: bankAccountLabel(account, portfolio), ownerId: bankAccountOwner(portfolio, account), balanceCents: balance === null ? null : netWorthCents(account.type, balance), plaid: account };
    }),
    ...manual.map((account) => ({ key: `m${account.id}`, group: manualAccountGroup(account.kind), name: account.name, ownerId: account.personId, balanceCents: account.liability ? -account.balanceCents || 0 : account.balanceCents, manual: account })),
  ];
}

/** Accounts tab: net worth with its history, every account grouped by type, and manual accounts. */
export function AccountsPage({ context, portfolio, notify, onOpenSettings, onShowTransactions }: FinancePageProps) {
  const today = isoDate(new Date());
  const [range, setRange] = useState<Range>("3M");
  const load = useCallback(async () => {
    const [bank, logins, manual] = await Promise.all([loadBankAccounts(context), loadBankLogins(context), loadManualAccounts(context)]);
    return { bank, logins, manual };
  }, [context]);
  const { data, error: accountsError, reload: reloadAccounts } = useFinanceLoad(load);
  // Only the history the chosen range needs (there's a row per account per day); the old range shows until it arrives.
  const loadHistory = useCallback(() => loadBalanceSnapshots(context, snapshotLoadStart(today, range)), [context, today, range]);
  const { data: snapshots, error: historyError, reload: reloadHistory } = useFinanceLoad(loadHistory);
  const error = accountsError || historyError;
  const reload = useCallback(async () => { await Promise.all([reloadAccounts(), reloadHistory()]); }, [reloadAccounts, reloadHistory]);
  const [owner, setOwner] = useState<OwnerFilter>(null);
  const [selected, setSelected] = useState<Selected>(null);
  const [showArchived, setShowArchived] = useState(false);
  const people = portfolio.people;

  const rows = useMemo(() => (data ? toRows(portfolio, data.bank, data.manual) : []), [data, portfolio]);
  const mine = useMemo(() => rows.filter((row) => owner === null || row.ownerId === owner), [rows, owner]);
  const active = useMemo(() => mine.filter((row) => !row.manual?.archived), [mine]);
  const archived = mine.filter((row) => row.manual?.archived);
  const assets = active.reduce((sum, row) => sum + Math.max(row.balanceCents ?? 0, 0), 0);
  const debts = active.reduce((sum, row) => sum - Math.min(row.balanceCents ?? 0, 0), 0);
  const net = assets - debts;

  const chart = useMemo(() => {
    if (!snapshots) return { points: [] as SeriesPoint[], firstDate: null };
    // Archived manual accounts are left out of the history too (they'd otherwise carry forward forever).
    const keys = new Set(active.map((row) => row.key));
    const start = rangeStart(today, range);
    const loaded = balanceSeries(snapshots, (snapshot) => keys.has(snapshotKey(snapshot)));
    // End on today's live balances so the chart and the headline agree.
    const points = withLiveEnd(seriesFrom(loaded, start), today, net);
    // When the history is shorter than the range, say where it starts.
    const firstDate = loaded.length && (!start || loaded[0].date > start) ? loaded[0].date : null;
    return { points, firstDate };
  }, [snapshots, active, range, today, net]);
  const change = periodChange(chart.points);

  const selectedRow = selected?.kind === "plaid" ? rows.find((row) => row.key === `p${selected.id}`) : selected?.kind === "manual" && selected.id !== null ? rows.find((row) => row.key === `m${selected.id}`) : undefined;

  const saveOwner = async (account: BankAccount, personId: number | null) => {
    try {
      await setBankAccountOwner(context, account.id, personId);
      notify(`Owner saved for ${bankAccountLabel(account, portfolio)}`);
      await reload();
    } catch (reason) { notify(reason instanceof Error ? reason.message : "Couldn't save the owner", true); }
  };

  const groups = ACCOUNT_GROUPS.map((group) => ({ ...group, rows: active.filter((row) => row.group === group.value).sort((left, right) => Math.abs(right.balanceCents ?? 0) - Math.abs(left.balanceCents ?? 0)) }))
    .filter((group) => group.rows.length);

  return (
    <FinanceSection
      title="Accounts"
      actions={<button type="button" className="btn small" onClick={() => setSelected({ kind: "manual", id: null })}>+ Add a manual account</button>}
      error={error}
      onRetry={() => void reload()}
    >
      {!data ? <FinanceLoading error={error} /> : rows.length === 0 ? (
        <FinanceEmpty onOpenSettings={onOpenSettings}>No accounts yet. Connect a bank, card or brokerage in Settings, or add one Plaid can&rsquo;t see (a private investment, a house, a loan) with &ldquo;Add a manual account&rdquo;.</FinanceEmpty>
      ) : (
        <>
          <div className="finance-filters">
            <OwnerButtons people={people} value={owner} onChange={setOwner} />
            <RangeButtons value={range} onChange={setRange} />
          </div>

          <div className="finance-card">
            <div className="stat-row">
              <div className="stat hero">
                <span className="stat-label">Net worth</span>
                <span className="stat-value">{moneyWhole(net)}</span>
                {change && chart.points.length > 1 && <span className="stat-delta"><Change cents={change.changeCents} percent={change.percent} /> since {fullDate(change.startDate)}</span>}
              </div>
              <div className="stat"><span className="stat-label">Assets</span><span className="stat-value">{moneyWhole(assets)}</span></div>
              <div className="stat"><span className="stat-label">Debts</span><span className="stat-value">{moneyWhole(debts)}</span></div>
            </div>
            <LineChart points={chart.points} label="Net worth" emptyText="Net worth history starts the day an account is connected or a manual balance is saved; a point is added every day." />
            {chart.firstDate && <p className="hint">History from {fullDate(chart.firstDate)}, when the first account was connected. Archived accounts are left out.</p>}
          </div>

          {groups.map((group) => {
            const total = group.rows.reduce((sum, row) => sum + (row.balanceCents ?? 0), 0);
            return (
              <section key={group.value} className="group" aria-label={group.label}>
                <div className="group-head static">
                  <h2>{group.label}</h2>
                  <span className="meta">{group.rows.length}</span>
                  <span className="num group-total">{moneyWhole(total)}</span>
                </div>
                <ul className="finance-list flush">
                  {group.rows.map((row) => (
                    <AccountRowItem key={row.key} row={row} people={people} today={today}
                      onOpen={() => setSelected(row.plaid ? { kind: "plaid", id: row.plaid.id } : { kind: "manual", id: row.manual!.id })}
                      onOwner={row.plaid ? (personId) => void saveOwner(row.plaid!, personId) : undefined} />
                  ))}
                </ul>
              </section>
            );
          })}
          {owner !== null && rows.some((row) => row.ownerId === null) && <p className="hint">Shared accounts (no owner) only count under Everyone. Set an owner on any account to move it.</p>}

          {archived.length > 0 && (
            <>
              <button type="button" className="btn small show-more" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived}>{showArchived ? "Hide" : "Show"} archived ({archived.length})</button>
              {showArchived && (
                <ul className="finance-list">
                  {archived.map((row) => <AccountRowItem key={row.key} row={row} people={people} today={today} dim onOpen={() => setSelected({ kind: "manual", id: row.manual!.id })} />)}
                </ul>
              )}
            </>
          )}
        </>
      )}

      {data && selected?.kind === "plaid" && selectedRow?.plaid && (
        <BankAccountDrawer
          row={selectedRow}
          account={selectedRow.plaid}
          login={data.logins.find((login) => login.id === selectedRow.plaid!.itemId)}
          portfolio={portfolio}
          context={context}
          onOwner={(personId) => void saveOwner(selectedRow.plaid!, personId)}
          onShowTransactions={() => { setSelected(null); onShowTransactions({ accountIds: [selectedRow.plaid!.id] }); }}
          onClose={() => setSelected(null)}
        />
      )}
      {data && selected?.kind === "manual" && (selected.id === null || selectedRow?.manual) && (
        <ManualAccountDrawer
          key={selected.id ?? "new"}
          account={selectedRow?.manual ?? null}
          people={people}
          defaultOwner={owner}
          context={context}
          onSave={async (draft) => {
            const saved = await saveManualAccount(context, selected.id, draft, today);
            notify(selected.id === null ? `Added ${saved.name}` : `Saved ${saved.name}`);
            await reload();
            setSelected(null);
          }}
          onDelete={async () => {
            await deleteManualAccount(context, selected.id!);
            notify(`Deleted ${selectedRow?.manual?.name ?? "the account"}`);
            await reload();
            setSelected(null);
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </FinanceSection>
  );
}

/** One account's own balance per day (all of its history); debts as the positive amount owed. Empty until loaded. */
function useAccountHistory(context: FinanceContext, account: { plaidAccountId: number } | { manualAccountId: number } | null, debt: boolean): SeriesPoint[] {
  const plaidAccountId = account && "plaidAccountId" in account ? account.plaidAccountId : null;
  const manualAccountId = account && "manualAccountId" in account ? account.manualAccountId : null;
  const load = useCallback(async () => {
    if (plaidAccountId === null && manualAccountId === null) return [];
    return loadBalanceSnapshots(context, null, plaidAccountId !== null ? { plaidAccountId } : { manualAccountId: manualAccountId! });
  }, [context, plaidAccountId, manualAccountId]);
  const { data } = useFinanceLoad(load);
  return useMemo(() => (data || []).map((snapshot) => ({ date: snapshot.date, valueCents: debt ? -snapshot.balanceCents || 0 : snapshot.balanceCents })), [data, debt]);
}

function rowDetail(row: Row, people: Portfolio["people"]) {
  const owner = people.find((person) => person.id === row.ownerId)?.name.split(/\s+/)[0];
  if (row.plaid) return [row.plaid.institutionName || "Bank", bankAccountKind(row.plaid), owner].filter(Boolean).join(" · ");
  return [kindLabel(row.manual!.kind), row.manual!.liability ? "debt" : null, "manual", owner].filter(Boolean).join(" · ");
}

function AccountRowItem({ row, people, today, dim, onOpen, onOwner }: { row: Row; people: Portfolio["people"]; today: string; dim?: boolean; onOpen: () => void; onOwner?: (personId: number | null) => void }) {
  const statement = row.plaid?.type === "credit" ? row.plaid.statement : null;
  const due = statement?.nextDueDate ? parseDate(statement.nextDueDate) : null;
  const dueIn = due ? daysBetween(parseDate(today)!, due) : null;
  return (
    <li className={`finance-row account-row${dim ? " dim" : ""}`}>
      <button type="button" className="account-open grow" onClick={onOpen}>
        <span className="account-name"><AccountName label={row.name} /></span>
        <small>
          {rowDetail(row, people)}
          {statement && statement.lastStatementCents !== null && <> · statement {moneyWhole(statement.lastStatementCents)}</>}
        </small>
        {statement && (statement.overdue || (dueIn !== null && dueIn >= 0 && dueIn <= 7)) && (
          <span className="account-tags">{statement.overdue ? <Tag tone="alert">Overdue</Tag> : <Tag tone="due">Due {shortDate(statement.nextDueDate)}</Tag>}</span>
        )}
        {statement && !statement.overdue && due && dueIn !== null && dueIn > 7 && <small>Due {shortDate(statement.nextDueDate)}</small>}
      </button>
      {onOwner && <OwnerSelect className="owner-select" people={people} value={row.ownerId} onChange={onOwner} label={`Owner of ${row.name}`} />}
      <span className={`num amount${row.balanceCents !== null && row.balanceCents < 0 ? " owed" : ""}`}>{row.balanceCents === null ? "—" : moneyExact(row.balanceCents)}</span>
    </li>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="fact"><dt>{label}</dt><dd>{children}</dd></div>;
}

function BankAccountDrawer({ row, account, login, portfolio, context, onOwner, onShowTransactions, onClose }: {
  row: Row; account: BankAccount; login: BankLogin | undefined; portfolio: Portfolio; context: FinanceContext;
  onOwner: (personId: number | null) => void; onShowTransactions?: () => void; onClose: () => void;
}) {
  const debt = isDebt(account);
  const history = useAccountHistory(context, { plaidAccountId: account.id }, debt);
  const balance = bankBalanceCents(account);
  const statement = account.statement;
  const linkedOwner = account.personId === null && row.ownerId !== null ? portfolio.person(row.ownerId)?.name : null;
  return (
    <Drawer title={bankAccountLabel(account, portfolio, { full: true })} onClose={onClose} footer={onShowTransactions && <button type="button" className="btn primary" onClick={onShowTransactions}>Show transactions</button>}>
      <div className="drawer-balance">
        <span className="stat-label">{debt ? "Balance owed" : "Balance"}</span>
        <span className="stat-value">{balance === null ? "—" : moneyExact(balance)}</span>
      </div>
      <div className="fieldset">
        <h3>{debt ? "Balance owed over time" : "Balance over time"}</h3>
        <LineChart points={history} label={debt ? "Balance owed" : "Balance"} height={160} emptyText="History starts the day this account was connected; a point is added at every sync." />
      </div>
      <div className="fieldset">
        <h3>Owner</h3>
        <label className="f">Whose account
          <OwnerSelect people={portfolio.people} value={row.ownerId} onChange={onOwner} label="Owner" />
        </label>
        {linkedOwner && <p className="hint">Counted as {linkedOwner}&rsquo;s from the linked card until you pick an owner.</p>}
      </div>
      <dl className="acct-facts">
        <Fact label="Institution">{account.institutionName || "—"}</Fact>
        <Fact label="Type">{bankAccountKind(account)}{account.mask ? ` ··${account.mask}` : ""}</Fact>
        {account.officialName && <Fact label="Bank's name">{account.officialName}</Fact>}
        {account.availableCents !== null && <Fact label="Available">{moneyExact(account.availableCents)}</Fact>}
        {account.limitCents !== null && <Fact label="Credit limit">{moneyExact(account.limitCents)}</Fact>}
        {statement.lastStatementCents !== null && <Fact label="Statement balance">{moneyExact(statement.lastStatementCents)}{statement.lastStatementDate ? ` (${fullDate(statement.lastStatementDate)})` : ""}</Fact>}
        {statement.minimumPaymentCents !== null && <Fact label="Minimum payment">{moneyExact(statement.minimumPaymentCents)}</Fact>}
        {statement.nextDueDate && <Fact label="Payment due">{fullDate(statement.nextDueDate)}{statement.overdue ? " (overdue)" : ""}</Fact>}
        {statement.lastPaymentCents !== null && <Fact label="Last payment">{moneyExact(statement.lastPaymentCents)}{statement.lastPaymentDate ? ` on ${fullDate(statement.lastPaymentDate)}` : ""}</Fact>}
        <Fact label="Last synced">{syncedAt(login?.lastSyncedAt ?? null)}{login?.status === "reconnect" ? " (needs reconnecting in Settings)" : ""}</Fact>
        {account.balancesUpdatedAt && <Fact label="Balance as of">{syncedAt(account.balancesUpdatedAt)}</Fact>}
      </dl>
    </Drawer>
  );
}

type ManualDraft = { name: string; kind: ManualAccountKind; liability: boolean; balance: string; personId: number | null; notes: string };

function ManualAccountDrawer({ account, people, defaultOwner, context, onSave, onDelete, onClose }: {
  account: ManualAccount | null; people: Portfolio["people"]; defaultOwner: number | null; context: FinanceContext;
  onSave: (draft: Partial<ManualAccount>) => Promise<void>; onDelete: () => Promise<void>; onClose: () => void;
}) {
  const [draft, setDraft] = useState<ManualDraft>(() => account
    ? { name: account.name, kind: account.kind, liability: account.liability, balance: toDollarsInput(account.balanceCents), personId: account.personId, notes: account.notes || "" }
    : { name: "", kind: "private_investment", liability: false, balance: "", personId: defaultOwner, notes: "" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const history = useAccountHistory(context, account ? { manualAccountId: account.id } : null, Boolean(account?.liability));
  const update = (patch: Partial<ManualDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setProblem("");
    try { await action(); } catch (reason) { setProblem(reason instanceof Error ? reason.message : "Couldn't save."); setBusy(false); }
  };
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!draft.name.trim()) { setProblem("Give the account a name."); return; }
    const balanceCents = Math.abs(toCents(draft.balance));
    const patch: Partial<ManualAccount> = { name: draft.name, kind: draft.kind, liability: draft.liability, personId: draft.personId, notes: draft.notes };
    // Only a changed balance (or a new account) writes a new balance snapshot.
    if (!account || balanceCents !== account.balanceCents) patch.balanceCents = balanceCents;
    void run(() => onSave(patch));
  };

  return (
    <Drawer
      title={account ? account.name : "Add a manual account"}
      onClose={onClose}
      footer={<>
        {account && <ConfirmButton className="btn danger" disabled={busy} label={`Delete ${account.name}`} onConfirm={() => void run(onDelete)} />}
        {account && <button type="button" className="btn" disabled={busy} onClick={() => void run(() => onSave({ archived: !account.archived }))}>{account.archived ? "Unarchive" : "Archive"}</button>}
        <button type="submit" form="manual-account-form" className="btn primary" disabled={busy}>{busy ? "Saving…" : account ? "Save" : "Add account"}</button>
      </>}
    >
      {!account && <p className="hint">For anything Plaid can&rsquo;t see: a private investment such as Edgar Street Capital, a house, a car, a loan. Update the balance whenever it changes; each update is a point in the history.</p>}
      <form id="manual-account-form" className="fieldset" onSubmit={submit}>
        <div className="fields">
          <label className="f full">Name
            <input value={draft.name} onChange={(event) => update({ name: event.target.value })} placeholder="Edgar Street Capital" autoFocus={!account} />
          </label>
          <label className="f">Kind
            <select value={draft.kind} onChange={(event) => { const kind = event.target.value as ManualAccountKind; update({ kind, liability: kind === "loan" ? true : draft.kind === "loan" ? false : draft.liability }); }}>
              {MANUAL_ACCOUNT_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
            </select>
          </label>
          <label className="f">Owner
            <OwnerSelect people={people} value={draft.personId} onChange={(personId) => update({ personId })} label="Owner" />
          </label>
          <div className="f full">
            <span id="manual-side">Counts as</span>
            <div className="seg" role="group" aria-labelledby="manual-side">
              <button type="button" aria-pressed={!draft.liability} onClick={() => update({ liability: false })}>Asset</button>
              <button type="button" aria-pressed={draft.liability} onClick={() => update({ liability: true })}>Debt</button>
            </div>
          </div>
          <label className="f full">{draft.liability ? "Amount owed" : "Current value"}
            <span className="dollar-input">
              <input type="number" min="0" step="0.01" inputMode="decimal" value={draft.balance} onChange={(event) => update({ balance: event.target.value })} placeholder="0.00" />
            </span>
          </label>
          <label className="f full">Notes
            <input value={draft.notes} onChange={(event) => update({ notes: event.target.value })} placeholder="Optional" />
          </label>
        </div>
        {account && <p className="hint">Balance last updated {syncedAt(account.balanceUpdatedAt)}.</p>}
        {problem && <p className="form-error" role="alert">{problem}</p>}
      </form>
      {account && (
        <div className="fieldset">
          <h3>{account.liability ? "Amount owed over time" : "Value over time"}</h3>
          <LineChart points={history} label={account.liability ? "Amount owed" : "Value"} height={160} emptyText="Each balance you save adds a point; the history fills in from there." />
        </div>
      )}
    </Drawer>
  );
}
