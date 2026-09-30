"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { creditState } from "../lib/core/credits";
import { atNoon } from "../lib/core/dates";
import { cardTag, holdingName, indexPortfolio, type Account, type PortfolioData } from "../lib/core/model";
import { dueItems, personStats } from "../lib/core/stats";
import * as data from "../lib/data";
import { AccountDrawer, type ProductChange } from "./AccountDrawer";
import { CardGroups, groupId } from "./CardGroups";
import { DueList } from "./DueList";
import { CardList } from "./CardList";
import { CreditMenu, type CellTarget } from "./CreditCell";
import { SettingsDrawer, type Membership } from "./SettingsDrawer";
import { GettingStarted } from "./GettingStarted";
import { CheckIcon, Dot, personTone, Toast, type ToastMessage } from "./ui";
import { money, shortDate } from "../lib/presentation/format";

type Props = { db: SupabaseClient; accessToken: string; onSignOut: () => Promise<void> };
type View = "cards" | "credits";
type Prefs = { view: View; collapsed: Record<string, boolean>; showClosed: boolean; creditsShowClosed: boolean };
type Panel = { kind: "account"; id: number | null } | { kind: "settings"; focus?: "people" } | null;
type Menu = { target: CellTarget; anchor: DOMRect } | null;

const PREFS_KEY = "cardfolio-prefs-v3";
const LIVE_TABLES = ["accounts", "account_products", "credits", "credit_uses", "credit_opt_outs", "products", "people", "action_rules"];
const DEFAULT_PREFS: Prefs = { view: "cards", collapsed: {}, showClosed: false, creditsShowClosed: false };

function readPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch { return DEFAULT_PREFS; }
}

export function Portfolio({ db, accessToken, onSignOut }: Props) {
  const [raw, setRaw] = useState<PortfolioData | null>(null);
  const [membership, setMembership] = useState<(Membership & { householdId: string }) | null>(null);
  const [loadError, setLoadError] = useState("");
  const [today, setToday] = useState(() => atNoon(new Date()));
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [menu, setMenu] = useState<Menu>(null);
  // Bumped after a product change so the open drawer re-reads the card instead of keeping a stale form.
  const [drawerVersion, setDrawerVersion] = useState(0);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const portfolio = useMemo(() => (raw ? indexPortfolio(raw) : null), [raw]);
  const context = useMemo<data.Context | null>(() => (membership ? { db, householdId: membership.householdId, email: membership.email } : null), [db, membership]);

  const updatePrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  const notify = useCallback((text: string, undo?: () => void, error = false) => setToast({ id: Date.now(), text, undo, error }), []);

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
    fetch("/api/session", { headers: { authorization: `Bearer ${accessToken}` } })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Couldn't open Cardfolio.");
        if (!active) return;
        setMembership(payload);
        await reload(payload.householdId);
      })
      .catch((reason) => active && setLoadError(reason instanceof Error ? reason.message : "Couldn't open Cardfolio."));
    return () => { active = false; };
  }, [accessToken, reload]);

  // Live updates: reload shortly after anyone in the household changes something.
  useEffect(() => {
    if (!membership) return;
    const channel = db.channel(`household-${membership.householdId}`);
    const onChange = () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => void reload(membership.householdId), 400);
    };
    for (const table of LIVE_TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `household_id=eq.${membership.householdId}` }, onChange);
    }
    channel.subscribe();
    const onFocus = () => {
      setToday(atNoon(new Date()));
      void reload(membership.householdId);
    };
    window.addEventListener("focus", onFocus);
    return () => { void db.removeChannel(channel); window.removeEventListener("focus", onFocus); };
  }, [db, membership, reload]);

  const syncSheet = useCallback(async () => {
    const response = await fetch("/api/export/google-sheet", { method: "POST", headers: { authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error((await response.json()).error || "Couldn't update the Google Sheet.");
  }, [accessToken]);
  const scheduleSync = useCallback(() => {
    if (!membership?.googleSheet) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => { syncSheet().catch((reason) => notify(reason.message, undefined, true)); }, 6000);
  }, [membership, notify, syncSheet]);

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
        optOuts: value.optOuts,
        uses: [
          ...value.uses.filter((use) => !(use.creditId === credit.id && use.holdingId === holding.id && use.periodKey === periodKey)),
          ...(amountCents === null ? [] : [{ id: -Date.now(), creditId: credit.id, holdingId: holding.id, periodKey, amountCents, usedOn: null, recordedBy: membership?.email || null, source: "manual" as const }]),
        ],
      }),
      success: `${message} ${credit.name} on ${holdingLabel}`,
      undo: () => setUse(target, previous, "Restored"),
    });
  }

  function toggleCredit(target: CellTarget) {
    if (!portfolio) return;
    const state = creditState(portfolio, target.credit, target.holding, today);
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

  const due = useMemo(() => (portfolio ? dueItems(portfolio, today, include) : []), [portfolio, today, include]);

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
  if (!portfolio || !membership || !context) return <main className="loading-screen" aria-live="polite"><p>Opening Cardfolio…</p></main>;

  const people = [...portfolio.people].sort((left, right) => left.sort - right.sort);
  const viewerPerson = people.find((person) => person.email && person.email.toLowerCase() === membership.email.toLowerCase()) || people[0];
  const groupProps = {
    portfolio, today, include, collapsed: prefs.collapsed,
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

  async function saveAccount(draft: data.AccountDraft, newProduct: data.ProductDraft | null) {
    const problem = data.validateDraft(draft);
    if (problem) throw new Error(problem);
    await write(async (ctx) => {
      const productId = newProduct ? await data.saveProduct(ctx, null, newProduct) : draft.productId;
      const final = { ...draft, productId };
      if (selectedAccount && selectedCurrent) await data.updateAccount(ctx, selectedAccount, selectedCurrent, final, portfolio!.holdings);
      else await data.createAccount(ctx, final, portfolio!.holdings);
    }, { success: selectedAccount ? "Saved" : "Card added", rethrow: true });
    setPanel(null);
  }

  async function changeProduct(change: ProductChange) {
    if (!selectedAccount || !selectedCurrent) return;
    await write(async (ctx) => {
      const productId = change.productId === "new" ? await data.saveProduct(ctx, null, change.newProduct!) : change.productId;
      await data.changeProduct(ctx, selectedAccount, selectedCurrent, { productId, date: change.date, annualFeeCents: change.annualFeeCents, last4: change.last4, direction: change.direction }, portfolio!.holdings);
    }, { success: "Product change saved", rethrow: true });
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

      <section className="people" aria-label="Cardholders">
        {people.map((person) => {
          const stats = personStats(portfolio, person.id, today);
          return (
            <div key={person.id} className="person">
              <Dot name={person.name} tone={personTone(person.sort)} large />
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

      <DueList portfolio={portfolio} items={due} onOpenAccount={groupProps.onOpenAccount} onOpenCredits={(product) => {
        updatePrefs({ view: "credits", collapsed: { ...prefs.collapsed, [`product-${product.id}`]: false } });
        requestAnimationFrame(() => document.getElementById(groupId(product.slug))?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }} />

      {portfolio.accounts.length > 0 && <div className="toolbar" role="toolbar" aria-label="View options">
        <div className="seg" aria-label="View">
          <button type="button" aria-pressed={prefs.view === "cards"} onClick={() => updatePrefs({ view: "cards" })}>Cards</button>
          <button type="button" aria-pressed={prefs.view === "credits"} onClick={() => updatePrefs({ view: "credits" })}>Credits</button>
        </div>
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
            <CardList portfolio={portfolio} accounts={cardList} today={today} onOpenAccount={groupProps.onOpenAccount} />
            {hiddenCount > 0 && (
              <button type="button" className="btn show-closed" aria-pressed={prefs.showClosed} onClick={() => updatePrefs({ showClosed: !prefs.showClosed })}>
                {prefs.showClosed ? "Hide closed & declined" : `Show closed & declined (${hiddenCount})`}
              </button>
            )}
          </>
        ) : (
          <>
            <div className="legend">
              <span><span className="cell used"><CheckIcon /></span>Used</span>
              <span><span className="cell partial"><span className="num">$30</span></span>Partly used</span>
              <span><span className="cell" />Not used</span>
              <span><span className="cell off">–</span>Not enrolled</span>
              <span>Tap a box to mark it used. Press and hold (or right-click) for a partial amount or to mark it not enrolled.</span>
            </div>
            <CardGroups {...groupProps} />
          </>
        )}
      </main>

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
            await write((ctx) => data.undoProductChange(ctx, selectedCurrent, previous), { success: "Product change removed", rethrow: true });
            setDrawerVersion((value) => value + 1);
          }}
          onDelete={async () => {
            if (!selectedAccount) return;
            await write((ctx) => data.deleteAccount(ctx, selectedAccount.id), { success: "Card deleted", rethrow: true });
            setPanel(null);
          }}
          onToggle={toggleCredit}
          onMenu={groupProps.onMenu}
        />
      )}

      {panel?.kind === "settings" && (
        <SettingsDrawer
          accessToken={accessToken}
          notify={(text, error) => notify(text, undefined, error)}
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
          onInvite={async (email) => {
            try {
              const response = await fetch("/api/session", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ action: "invite", email }) });
              const payload = await response.json().catch(() => ({}));
              if (!response.ok) throw new Error(payload.error || "Couldn't send the invitation.");
              setMembership({ ...membership, ...payload });
              notify(`Invited ${email}. They can sign in with that email now.`);
              return true;
            } catch (reason) {
              notify(reason instanceof Error ? reason.message : "Couldn't send the invitation.", undefined, true);
              return false;
            }
          }}
          onSyncSheet={() => syncSheet().then(() => notify("Google Sheet updated"), (reason) => notify(reason.message, undefined, true))}
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
