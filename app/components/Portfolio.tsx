"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { creditState } from "../lib/core/credits";
import { atNoon } from "../lib/core/dates";
import { cardTag, holdingName, indexPortfolio, type Account, type PortfolioData } from "../lib/core/model";
import { dueItems, personStats } from "../lib/core/stats";
import * as data from "../lib/data";
import { errorText, sessionApi } from "../lib/api";
import { AccountDrawer, type ProductChange } from "./AccountDrawer";
import { CardGroups, groupId } from "./CardGroups";
import { DueList } from "./DueList";
import { CardList } from "./CardList";
import { CreditSuggestions } from "./CreditSuggestions";
import { useCardPlaid } from "./useCardPlaid";
import type { CreditSuggestion } from "../lib/core/card-plaid";
import { CreditMenu, type CellTarget } from "./CreditCell";
import { SettingsDrawer, type Membership } from "./SettingsDrawer";
import { GettingStarted } from "./GettingStarted";
import { AccountsPage } from "./AccountsPage";
import { CashFlowPage } from "./CashFlowPage";
import type { FinancePageProps } from "./FinanceShared";
import { InvestmentsPage } from "./InvestmentsPage";
import { TransactionsPage } from "./TransactionsPage";
import type { FinanceContext } from "../lib/finance-data";
import { CheckIcon, Dot, personTone, Toast, type ToastMessage } from "./ui";
import { DEFAULT_TRANSACTION_FILTERS, type TransactionFilters } from "../lib/presentation/transaction-view";
import { money, shortDate } from "../lib/presentation/format";

/** `userId` keys the session: token refreshes don't reload anything (API calls read the latest token). */
type Props = { db: SupabaseClient; userId: string; onSignOut: () => Promise<void> };
type FinanceView = "transactions" | "cashflow" | "investments" | "accounts";
type View = "cards" | "credits" | FinanceView;
// Top-level tabs. Cards and Credits share the to-do list and search; each finance tab is its own page component.
const TABS: { view: View; label: string }[] = [
  { view: "cards", label: "Cards" },
  { view: "credits", label: "Credits" },
  { view: "transactions", label: "Transactions" },
  { view: "cashflow", label: "Cash flow" },
  { view: "investments", label: "Investments" },
  { view: "accounts", label: "Accounts" },
];
const FINANCE_PAGES: Record<FinanceView, (props: FinancePageProps) => ReactNode> = {
  transactions: TransactionsPage,
  cashflow: CashFlowPage,
  investments: InvestmentsPage,
  accounts: AccountsPage,
};
type Prefs = { view: View; collapsed: Record<string, boolean>; showClosed: boolean; creditsShowClosed: boolean };
type Panel = { kind: "account"; id: number | null } | { kind: "settings"; focus?: "people" } | null;
type Menu = { target: CellTarget; anchor: DOMRect } | null;

const PREFS_KEY = "cardfolio-prefs-v3";
const LIVE_TABLES = ["accounts", "account_products", "credits", "credit_uses", "credit_opt_outs", "products", "people", "action_rules"];
const DEFAULT_PREFS: Prefs = { view: "cards", collapsed: {}, showClosed: false, creditsShowClosed: false };

function readPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const prefs = { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") } as Prefs;
    return TABS.some((tab) => tab.view === prefs.view) ? prefs : { ...prefs, view: "cards" };
  } catch { return DEFAULT_PREFS; }
}

export function Portfolio({ db, userId, onSignOut }: Props) {
  const [raw, setRaw] = useState<PortfolioData | null>(null);
  const [membership, setMembership] = useState<(Membership & { householdId: string }) | null>(null);
  const [loadError, setLoadError] = useState("");
  const [today, setToday] = useState(() => atNoon(new Date()));
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const [search, setSearch] = useState("");
  const [transactionFilters, setTransactionFilters] = useState<TransactionFilters>(DEFAULT_TRANSACTION_FILTERS);
  const [panel, setPanel] = useState<Panel>(null);
  const [menu, setMenu] = useState<Menu>(null);
  // Bumped after a product change so the open drawer re-reads the card instead of keeping a stale form.
  const [drawerVersion, setDrawerVersion] = useState(0);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const portfolio = useMemo(() => (raw ? indexPortfolio(raw) : null), [raw]);
  const api = useMemo(() => sessionApi(db), [db]);
  // Built from primitives so an invite (which updates the member list) doesn't rebuild them.
  const householdId = membership?.householdId ?? null;
  const email = membership?.email ?? "";
  const googleSheet = membership?.googleSheet ?? false;
  const context = useMemo<data.Context | null>(() => (householdId ? { db, householdId, email } : null), [db, householdId, email]);
  const financeContext = useMemo<FinanceContext | null>(() => (householdId ? { db, householdId } : null), [db, householdId]);

  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  const notify = useCallback((text: string, undo?: () => void, error = false) => setToast({ id: Date.now(), text, undo, error }), []);
  const settingsNotify = useCallback((text: string, error?: boolean) => notify(text, undefined, error), [notify]);

  const reload = useCallback(async (householdId: string) => {
    try {
      setRaw(await data.loadPortfolio(db, householdId));
      setLoadError("");
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "Couldn't load your cards.");
    }
  }, [db]);

  // Membership first (the server accepts invitations), then the data itself.
  useEffect(() => {
    let active = true;
    api<Membership & { householdId: string }>("/api/session", { fallback: "Couldn't open Cardfolio." })
      .then(async (payload) => {
        if (!active) return;
        setMembership(payload);
        await reload(payload.householdId);
      })
      .catch((reason) => active && setLoadError(errorText(reason, "Couldn't open Cardfolio.")));
    return () => { active = false; };
  }, [api, userId, reload]);

  // Live updates: reload shortly after anyone in the household changes something.
  useEffect(() => {
    if (!householdId) return;
    const channel = db.channel(`household-${householdId}`);
    const onChange = () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => void reload(householdId), 400);
    };
    for (const table of LIVE_TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `household_id=eq.${householdId}` }, onChange);
    }
    channel.subscribe();
    const onFocus = () => {
      setToday(atNoon(new Date()));
      void reload(householdId);
    };
    window.addEventListener("focus", onFocus);
    return () => { void db.removeChannel(channel); window.removeEventListener("focus", onFocus); };
  }, [db, householdId, reload]);

  const syncSheet = useCallback(async () => {
    await api("/api/export/google-sheet", { method: "POST", fallback: "Couldn't update the Google Sheet." });
  }, [api]);
  const scheduleSync = useCallback(() => {
    if (!googleSheet) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => { syncSheet().catch((reason) => notify(errorText(reason, "Couldn't update the Google Sheet."), undefined, true)); }, 6000);
  }, [googleSheet, notify, syncSheet]);

  /**
   * Runs a write, then reloads. Optional `optimistic` updates the page before the write finishes.
   * Resolves to whether it saved (failures show a toast unless `rethrow` is set).
   */
  const write = useCallback(async (action: (context: data.Context) => Promise<unknown>, options: { optimistic?: (value: PortfolioData) => PortfolioData; success?: string; undo?: () => void; rethrow?: boolean } = {}): Promise<boolean> => {
    if (!context) return false;
    if (options.optimistic) setRaw((value) => (value ? options.optimistic!(value) : value));
    try {
      await action(context);
      if (options.success) notify(options.success, options.undo);
      scheduleSync();
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Couldn't save that change.";
      if (options.rethrow) throw reason;
      notify(message, undefined, true);
      return false;
    } finally {
      await reload(context.householdId);
    }
  }, [context, notify, reload, scheduleSync]);

  // ---------- credits ----------
  function setUse(target: CellTarget, amountCents: number | null, message: string) {
    if (!portfolio) return;
    const { credit, holding } = target;
    const state = creditState(portfolio, credit, holding, today);
    if (state.kind === "off") return;
    const periodKey = state.period.key;
    const previous = state.usedCents || null;
    const holdingLabel = holdingName(portfolio, holding);
    void write((ctx) => data.setCreditUse(ctx, credit.id, holding.id, periodKey, amountCents), {
      optimistic: (value) => ({
        ...value,
        uses: [
          ...value.uses.filter((use) => !(use.creditId === credit.id && use.holdingId === holding.id && use.periodKey === periodKey)),
          ...(amountCents === null ? [] : [{ id: -Date.now(), creditId: credit.id, holdingId: holding.id, periodKey, amountCents, usedOn: null, recordedBy: email || null, source: "manual" as const }]),
        ],
      }),
      success: `${message} ${credit.name} on ${holdingLabel}`,
      undo: () => setUse(target, previous, "Restored"),
    });
  }

  function toggleCredit(target: CellTarget) {
    if (!portfolio) return;
    const state = creditState(portfolio, target.credit, target.holding, today);
    if (state.kind === "used" && state.auto) {
      notify(`${target.credit.name} is always used, so there's nothing to tick. Change it in Settings → Card types and credits.`);
      return;
    }
    if (state.kind === "used") setUse(target, null, "Cleared");
    else setUse(target, target.credit.amountCents, "Marked used:");
  }

  function setEnrolled(target: CellTarget, enrolled: boolean) {
    const { credit, holding } = target;
    void write((ctx) => data.setOptOut(ctx, credit.id, holding.id, !enrolled), {
      optimistic: (value) => ({
        ...value,
        optOuts: enrolled
          ? value.optOuts.filter((row) => !(row.creditId === credit.id && row.holdingId === holding.id))
          : [...value.optOuts, { creditId: credit.id, holdingId: holding.id }],
      }),
      success: `${credit.name} ${enrolled ? "tracked" : "marked not enrolled"} on ${portfolio ? holdingName(portfolio, holding) : ""}`,
      undo: () => setEnrolled(target, !enrolled),
    });
  }

  // ---------- filters ----------
  const include = useCallback((account: Account) => {
    if (!portfolio) return false;
    if (!search) return true;
    const haystack = [
      portfolio.person(account.personId)?.name,
      account.note,
      ...portfolio.holdingsOf(account.id).flatMap((holding) => {
        const product = portfolio.product(holding.productId);
        return [product?.name, product?.slug, product?.shortName, product?.issuer, holding.last4, cardTag(portfolio, holding)];
      }),
    ].join(" ").toLowerCase();
    return search.toLowerCase().split(/\s+/).every((word) => haystack.includes(word));
  }, [portfolio, search]);

  // Bank details for Plaid-linked cards (null when none are linked or Plaid isn't set up).
  const cardPlaid = useCardPlaid(financeContext, portfolio, today);
  const plaid = cardPlaid.view;
  const due = useMemo(() => (portfolio ? dueItems(portfolio, today, include, plaid?.payments) : []), [portfolio, today, include, plaid]);

  /** Records a suggested credit use from a bank transaction, after a person taps Record. */
  function acceptSuggestion(suggestion: CreditSuggestion) {
    if (!portfolio) return;
    const { credit, holding, transaction, recordCents, key } = suggestion;
    const state = creditState(portfolio, credit, holding, today);
    if (state.kind === "off") return;
    const periodKey = state.period.key;
    const previous = state.usedCents || null;
    // Hidden right away; shown again if the write fails, so the credit can still be recorded.
    cardPlaid.remember(key);
    void write((ctx) => data.setCreditUse(ctx, credit.id, holding.id, periodKey, recordCents, { source: "plaid", usedOn: transaction.date }), {
      optimistic: (value) => ({
        ...value,
        uses: [
          ...value.uses.filter((use) => !(use.creditId === credit.id && use.holdingId === holding.id && use.periodKey === periodKey)),
          { id: -Date.now(), creditId: credit.id, holdingId: holding.id, periodKey, amountCents: recordCents, usedOn: transaction.date, recordedBy: email || null, source: "plaid" as const },
        ],
      }),
      success: `Recorded ${credit.name} on ${holdingName(portfolio, holding)}`,
      undo: () => {
        cardPlaid.forget(key);
        setUse({ credit, holding }, previous, "Restored");
      },
    }).then((ok) => { if (!ok) cardPlaid.forget(key); });
  }

  function dismissSuggestion(suggestion: CreditSuggestion) {
    cardPlaid.remember(suggestion.key);
    notify(`Dismissed ${suggestion.credit.name}${portfolio ? ` on ${holdingName(portfolio, suggestion.holding)}` : ""}`, () => cardPlaid.forget(suggestion.key));
  }

  if (loadError && !portfolio) {
    return (
      <main className="loading-screen">
        <div className="auth-card">
          <h1>Cardfolio couldn&apos;t open</h1>
          <p>{loadError}</p>
          <div className="inline-actions">
            <button type="button" className="btn primary" onClick={() => window.location.reload()}>Try again</button>
            <button type="button" className="btn" onClick={() => void onSignOut()}>Sign out</button>
          </div>
        </div>
      </main>
    );
  }
  if (!portfolio || !membership || !context || !financeContext) return <main className="loading-screen" aria-live="polite"><p>Opening Cardfolio…</p></main>;

  const people = [...portfolio.people].sort((left, right) => left.sort - right.sort);
  const viewerPerson = people.find((person) => person.email && person.email.toLowerCase() === membership.email.toLowerCase()) || people[0];
  const groupProps = {
    portfolio, today, include, collapsed: prefs.collapsed, plaid,
    showClosed: prefs.creditsShowClosed,
    onShowClosed: (show: boolean) => updatePrefs({ creditsShowClosed: show }),
    onCollapse: (key: string) => updatePrefs({ collapsed: { ...prefs.collapsed, [key]: !prefs.collapsed[key] } }),
    onOpenAccount: (id: number) => setPanel({ kind: "account", id }),
    onToggle: toggleCredit,
    onMenu: (target: CellTarget, anchor: DOMRect) => setMenu({ target, anchor }),
  };
  const isCurrent = (account: Account) => account.status === "open" || account.status === "pending";
  const hiddenCount = portfolio.accounts.filter((account) => !isCurrent(account) && include(account)).length;
  const cardList = portfolio.accounts.filter((account) => include(account) && (prefs.showClosed || isCurrent(account)))
    .sort((left, right) => String(right.appliedOn || right.approvedOn).localeCompare(String(left.appliedOn || left.approvedOn)) || right.id - left.id);
  const menuState = menu ? creditState(portfolio, menu.target.credit, menu.target.holding, today) : null;
  const selectedAccount = panel?.kind === "account" && panel.id !== null ? portfolio.account(panel.id) : undefined;
  const selectedCurrent = selectedAccount ? portfolio.current(selectedAccount.id) : undefined;
  const FinancePage = prefs.view === "cards" || prefs.view === "credits" ? null : FINANCE_PAGES[prefs.view];

  async function saveAccount(draft: data.AccountDraft, newProduct: data.ProductDraft | null, message?: string) {
    const problem = data.validateDraft(draft);
    if (problem) throw new Error(problem);
    await write(async (ctx) => {
      if (!selectedAccount || !selectedCurrent) return data.createAccount(ctx, draft, newProduct);
      const productId = newProduct ? await data.saveProduct(ctx, null, newProduct) : draft.productId;
      await data.updateAccount(ctx, selectedAccount, selectedCurrent, { ...draft, productId }, portfolio!.holdings);
    }, { success: message ?? (selectedAccount ? "Saved" : "Card added"), rethrow: true });
    setPanel(null);
  }

  async function changeProduct(change: ProductChange) {
    if (!selectedAccount || !selectedCurrent) return;
    await write((ctx) => data.changeProduct(ctx, selectedAccount.id, {
      productId: change.productId === "new" ? null : change.productId,
      newProduct: change.productId === "new" ? change.newProduct : null,
      date: change.date, annualFeeCents: change.annualFeeCents, last4: change.last4, direction: change.direction,
    }), { success: "Product change saved", rethrow: true });
    setDrawerVersion((value) => value + 1);
  }

  return (
    <div className="page">
      <header className="top">
        <div className="brand"><h1>Cardfolio</h1><span>{today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</span></div>
        <button className="btn" type="button" onClick={() => setPanel({ kind: "settings" })}>Settings</button>
        <button className="btn primary" type="button" onClick={() => setPanel(people.length ? { kind: "account", id: null } : { kind: "settings", focus: "people" })}>+ Add card</button>
      </header>

      {loadError && <div className="error-banner" role="alert"><span>{loadError}</span><button type="button" className="btn small" onClick={() => void reload(membership.householdId)}>Retry</button></div>}

      <nav className="tabs" aria-label="Sections">
        {TABS.map((tab) => (
          <button key={tab.view} type="button" aria-pressed={prefs.view === tab.view} onClick={() => updatePrefs({ view: tab.view })}>{tab.label}</button>
        ))}
      </nav>

      {FinancePage ? (
        <main className="portfolio-views">
          <FinancePage context={financeContext} portfolio={portfolio} notify={settingsNotify} onOpenSettings={() => setPanel({ kind: "settings" })}
            transactionFilters={transactionFilters} onTransactionFilters={setTransactionFilters}
            onShowTransactions={(filters) => { setTransactionFilters({ ...DEFAULT_TRANSACTION_FILTERS, ...filters }); updatePrefs({ view: "transactions" }); window.scrollTo({ top: 0 }); }} />
        </main>
      ) : <>
      <section className="people" aria-label="Cardholders">
        {people.map((person) => {
          const stats = personStats(portfolio, person.id, today);
          return (
            <div key={person.id} className="person">
              <Dot name={person.name} tone={personTone(person.sort)} />
              <strong>{person.name}</strong>
              <span className="facts">
                <span><b className="num">{stats.open}</b> open</span>
                <span><b className="num">{stats.closed}</b> closed</span>
                <span>5/24 <b className="num">{stats.fiveTwentyFour.count}</b>{stats.fiveTwentyFour.nextDrop ? `, drops ${shortDate(stats.fiveTwentyFour.nextDrop)}` : ""}</span>
                {stats.pending > 0 && <span><b className="num">{stats.pending}</b> pending</span>}
              </span>
            </div>
          );
        })}
      </section>

      <DueList portfolio={portfolio} items={due} plaid={plaid} onOpenAccount={groupProps.onOpenAccount} onOpenCredits={(product) => {
        updatePrefs({ view: "credits", collapsed: { ...prefs.collapsed, [`product-${product.id}`]: false } });
        requestAnimationFrame(() => document.getElementById(groupId(product.slug))?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }} />

      {portfolio.accounts.length > 0 && <div className="toolbar" role="toolbar" aria-label="View options">
        <input className="search" type="search" placeholder="Search cards, notes, last digits" aria-label="Search cards, notes, or last digits" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>}

      <main className="portfolio-views">
        {portfolio.accounts.length === 0 ? (
          <GettingStarted hasPeople={people.length > 0} hasCredits={portfolio.credits.length > 0}
            onAddPerson={() => setPanel({ kind: "settings", focus: "people" })}
            onAddCard={() => setPanel({ kind: "account", id: null })}
            onSettings={() => setPanel({ kind: "settings" })} />
        ) : prefs.view === "cards" ? (
          <>
            <CardList portfolio={portfolio} accounts={cardList} today={today} plaid={plaid} searching={Boolean(search.trim())} onOpenAccount={groupProps.onOpenAccount} />
            {hiddenCount > 0 && (
              <button type="button" className="btn show-closed" aria-pressed={prefs.showClosed} onClick={() => updatePrefs({ showClosed: !prefs.showClosed })}>
                {prefs.showClosed ? "Hide closed & declined" : `Show closed & declined (${hiddenCount})`}
              </button>
            )}
          </>
        ) : (
          <>
            {plaid && <CreditSuggestions portfolio={portfolio} onAccept={acceptSuggestion} onDismiss={dismissSuggestion}
              suggestions={plaid.suggestions.filter((suggestion) => { const account = portfolio.account(suggestion.holding.accountId); return !!account && include(account); })} />}
            <div className="legend">
              <span><span className="cell used"><CheckIcon /></span>Used</span>
              <span><span className="cell partial"><span className="num">$30</span></span>Partly used</span>
              <span><span className="cell" />Not used</span>
              <span><span className="cell off">–</span>Not enrolled</span>
              {plaid && plaid.suggestions.length > 0 && <span><span className="cell suggested" />Bank shows a credit</span>}
              {portfolio.credits.some((credit) => credit.mode === "auto") && <span><span className="cell used auto"><CheckIcon /></span>Always used</span>}
              <span>Tap a box to mark it used. Press and hold (or right-click) for a partial amount or to mark it not enrolled.</span>
            </div>
            <CardGroups {...groupProps} />
          </>
        )}
      </main>
      </>}

      {panel?.kind === "account" && (
        <AccountDrawer
          key={`${panel.id ?? "new"}-${drawerVersion}`}
          portfolio={portfolio}
          accountId={panel.id}
          defaultPersonId={viewerPerson?.id ?? 0}
          today={today}
          onClose={() => setPanel(null)}
          onSave={saveAccount}
          onChangeProduct={changeProduct}
          onUndoChange={async () => {
            if (!selectedAccount || !selectedCurrent) return;
            const previous = portfolio.holdingsOf(selectedAccount.id).filter((holding) => holding.id !== selectedCurrent.id).pop();
            if (!previous) return;
            await write((ctx) => data.undoProductChange(ctx, selectedAccount.id), { success: "Product change removed", rethrow: true });
            setDrawerVersion((value) => value + 1);
          }}
          onDelete={async () => {
            if (!selectedAccount) return;
            await write((ctx) => data.deleteAccount(ctx, selectedAccount.id), { success: "Card deleted", rethrow: true });
            setPanel(null);
          }}
          onToggle={toggleCredit}
          onMenu={groupProps.onMenu}
          plaid={selectedAccount ? plaid?.byAccount.get(selectedAccount.id) : null}
          onAcceptSuggestion={acceptSuggestion}
          onDismissSuggestion={dismissSuggestion}
        />
      )}

      {panel?.kind === "settings" && (
        <SettingsDrawer
          api={api}
          onBankChanged={cardPlaid.refresh}
          notify={settingsNotify}
          portfolio={portfolio}
          today={today}
          membership={membership}
          focus={panel.focus}
          onClose={() => setPanel(null)}
          onSaveProduct={(id, draft) => write((ctx) => data.saveProduct(ctx, id, draft), { success: "Saved" })}
          onSaveCredit={(id, draft) => write((ctx) => data.saveCredit(ctx, id, draft), { success: id === null ? "Credit added" : "Saved" })}
          onDeleteCredit={(id) => write((ctx) => data.deleteCredit(ctx, id), { success: "Credit deleted" })}
          onToggleRule={(id, enabled) => write((ctx) => data.setRuleEnabled(ctx, id, enabled))}
          onAddPerson={(name) => write((ctx) => data.addPerson(ctx, { name }, people.length), { success: `Added ${name.trim()}` })}
          onSavePerson={(id, name, code) => write((ctx) => data.savePerson(ctx, id, { name, code }), { success: "Saved" })}
          onInvite={async (invitee) => {
            try {
              const payload = await api<Partial<Membership>>("/api/session", { method: "POST", body: { action: "invite", email: invitee }, fallback: "Couldn't send the invitation." });
              setMembership((current) => current && { ...current, ...payload });
              notify(`Invited ${invitee}. They can sign in with that email now.`);
              return true;
            } catch (reason) {
              notify(errorText(reason, "Couldn't send the invitation."), undefined, true);
              return false;
            }
          }}
          onSyncSheet={() => syncSheet().then(() => notify("Google Sheet updated"), (reason) => notify(errorText(reason, "Couldn't update the Google Sheet."), undefined, true))}
          onSignOut={onSignOut}
        />
      )}

      {menu && menuState && (
        <CreditMenu
          credit={menu.target.credit}
          state={menuState}
          anchor={menu.anchor}
          heading={holdingName(portfolio, menu.target.holding)}
          onClose={() => setMenu(null)}
          onUse={(amountCents) => { setMenu(null); setUse(menu.target, amountCents, amountCents === null ? "Cleared" : amountCents >= menu.target.credit.amountCents ? "Marked used:" : `Logged ${money(amountCents)} of`); }}
          onEnroll={(enrolled) => { setMenu(null); setEnrolled(menu.target, enrolled); }}
        />
      )}

      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
