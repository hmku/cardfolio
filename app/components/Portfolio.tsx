"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { creditState } from "../lib/core/credits";
import { atNoon } from "../lib/core/dates";
import { bonusLabel, holdingName, indexPortfolio, type Account, type Portfolio as PortfolioModel, type PortfolioData } from "../lib/core/model";
import { dueItems, personStats, type DueItem } from "../lib/core/stats";
import * as data from "../lib/data";
import { AccountDrawer, type ProductChange } from "./AccountDrawer";
import { CardGroups, groupId, OtherCards, PendingApplications, TimelineTable, type CellTarget } from "./CardGroups";
import { CreditMenu } from "./CreditCell";
import { SettingsDrawer, type Membership } from "./SettingsDrawer";
import { CheckIcon, Dot, inDays, money, personTone, shortDate, Toast, type ToastMessage } from "./ui";

type Props = { db: SupabaseClient; accessToken: string; onSignOut: () => Promise<void> };
type View = "cards" | "timeline";
type Prefs = { person: number | "all"; view: View; collapsed: Record<string, boolean>; history: boolean };
type Panel = { kind: "account"; id: number | null } | { kind: "settings" } | null;
type Menu = { target: CellTarget; anchor: DOMRect } | null;

const PREFS_KEY = "cardfolio-prefs-v2";
const LIVE_TABLES = ["accounts", "account_products", "credits", "credit_uses", "credit_opt_outs", "products", "people", "action_rules"];
const DEFAULT_PREFS: Prefs = { person: "all", view: "cards", collapsed: {}, history: false };

function readPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch { return DEFAULT_PREFS; }
}

function dueText(portfolio: PortfolioModel, item: DueItem) {
  const who = (account: Account) => {
    const holding = portfolio.current(account.id);
    return `${portfolio.person(account.personId)?.name} · ${holding ? holdingName(portfolio, holding) : ""}`;
  };
  switch (item.kind) {
    case "credit":
      return { label: "Credit", text: `${item.credit.name} ${money(item.credit.amountCents)} on ${portfolio.product(item.credit.productId)?.name}: ${item.holdings.length} card${item.holdings.length === 1 ? "" : "s"} left`, when: `${item.period.label} ends ${inDays(item.daysLeft)}` };
    case "review":
      return { label: "Review", text: `${item.rule.name}: ${who(item.account)}`, when: "" };
    case "bonus":
      return item.daysLeft < 0
        ? { label: "Bonus", text: `Mark the ${bonusLabel(item.account.bonus!)} bonus earned, or note what happened: ${who(item.account)}`, when: `deadline was ${shortDate(item.deadline)}` }
        : { label: "Bonus", text: `Spend ${item.account.bonus?.spendCents ? money(item.account.bonus.spendCents) : "the minimum"} for ${bonusLabel(item.account.bonus!)}: ${who(item.account)}`, when: `by ${shortDate(item.deadline)} (${inDays(item.daysLeft)})` };
    case "pending":
      return { label: "Pending", text: `${who(item.account)} application`, when: `applied ${item.daysWaiting}d ago` };
  }
}

export function Portfolio({ db, accessToken, onSignOut }: Props) {
  const [raw, setRaw] = useState<PortfolioData | null>(null);
  const [membership, setMembership] = useState<(Membership & { householdId: string }) | null>(null);
  const [loadError, setLoadError] = useState("");
  const [today, setToday] = useState(() => atNoon(new Date()));
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const [dueOnly, setDueOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [menu, setMenu] = useState<Menu>(null);
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

  /** Runs a write, then reloads. Optional `optimistic` updates the page before the write finishes. */
  const write = useCallback(async (action: (context: data.Context) => Promise<unknown>, options: { optimistic?: (value: PortfolioData) => PortfolioData; success?: string; undo?: () => void; rethrow?: boolean } = {}) => {
    if (!context) return;
    if (options.optimistic) setRaw((value) => (value ? options.optimistic!(value) : value));
    try {
      await action(context);
      if (options.success) notify(options.success, options.undo);
      scheduleSync();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Couldn't save that change.";
      if (options.rethrow) throw reason;
      notify(message, undefined, true);
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
    const holdingLabel = `${portfolio.person(holding.personId)?.name} #${holding.number ?? "?"}`;
    void write((ctx) => data.setCreditUse(ctx, credit.id, holding.id, periodKey, amountCents), {
      optimistic: (value) => ({
        ...value,
        optOuts: value.optOuts,
        uses: [
          ...value.uses.filter((use) => !(use.creditId === credit.id && use.holdingId === holding.id && use.periodKey === periodKey)),
          ...(amountCents === null ? [] : [{ id: -Date.now(), creditId: credit.id, holdingId: holding.id, periodKey, amountCents, usedOn: null, recordedBy: membership?.email || null, source: "manual" as const }]),
        ],
      }),
      success: `${message} ${credit.name} on ${portfolio.product(credit.productId)?.name} · ${holdingLabel}`,
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
      success: `${credit.name} ${enrolled ? "tracked" : "marked not enrolled"} on ${portfolio?.person(holding.personId)?.name} #${holding.number ?? "?"}`,
      undo: () => setEnrolled(target, !enrolled),
    });
  }

  // ---------- filters ----------
  const include = useCallback((account: Account) => {
    if (!portfolio) return false;
    if (prefs.person !== "all" && account.personId !== prefs.person) return false;
    if (!search) return true;
    const haystack = [
      portfolio.person(account.personId)?.name,
      account.note,
      ...portfolio.holdingsOf(account.id).flatMap((holding) => {
        const product = portfolio.product(holding.productId);
        return [product?.name, product?.slug, product?.issuer, holding.last4, holding.number ? `#${holding.number}` : ""];
      }),
    ].join(" ").toLowerCase();
    return search.toLowerCase().split(/\s+/).every((word) => haystack.includes(word));
  }, [portfolio, prefs.person, search]);

  const due = useMemo(() => (portfolio ? dueItems(portfolio, today, include) : []), [portfolio, today, include]);
  const dueHoldings = useMemo(() => new Set(due.flatMap((item) => (item.kind === "credit" ? item.holdings.map((holding) => holding.id) : [portfolio?.current(item.account.id)?.id ?? -1]))), [due, portfolio]);

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
    portfolio, today, include, dueOnly, dueHoldings, collapsed: prefs.collapsed,
    onCollapse: (key: string) => updatePrefs({ collapsed: { ...prefs.collapsed, [key]: !prefs.collapsed[key] } }),
    onOpenAccount: (id: number) => setPanel({ kind: "account", id }),
    onToggle: toggleCredit,
    onMenu: (target: CellTarget, anchor: DOMRect) => setMenu({ target, anchor }),
  };
  const history = portfolio.accounts.filter((account) => (account.status === "closed" || account.status === "declined") && include(account))
    .sort((left, right) => String(right.closedOn || right.appliedOn).localeCompare(String(left.closedOn || left.appliedOn)));
  const timeline = portfolio.accounts.filter(include)
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
  }

  return (
    <div className="page">
      <header className="top">
        <div className="brand"><h1>Cardfolio</h1><span>{today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</span></div>
        <button className="btn" type="button" onClick={() => setPanel({ kind: "settings" })}>Settings</button>
        <button className="btn primary" type="button" onClick={() => setPanel({ kind: "account", id: null })}>+ Add card</button>
      </header>

      {loadError && <div className="error-banner" role="alert"><span>{loadError}</span><button type="button" className="btn small" onClick={() => void reload(membership.householdId)}>Retry</button></div>}

      <section className="people" aria-label="Cardholders">
        {people.map((person) => {
          const stats = personStats(portfolio, person.id, today);
          const selected = prefs.person === person.id;
          return (
            <button key={person.id} type="button" className={`person ${selected ? "selected" : ""}`} aria-pressed={selected} onClick={() => updatePrefs({ person: selected ? "all" : person.id })}>
              <Dot name={person.name} tone={personTone(person.sort)} large />
              <strong>{person.name}</strong>
              <span className="facts">
                <span><b className="num">{stats.open}</b> open</span>
                <span><b className="num">{stats.closed}</b> closed</span>
                <span>5/24 <b className="num">{stats.fiveTwentyFour.count}</b>{stats.fiveTwentyFour.nextDrop ? `, drops ${shortDate(stats.fiveTwentyFour.nextDrop)}` : ""}</span>
                {stats.pending > 0 && <span><b className="num">{stats.pending}</b> pending</span>}
              </span>
            </button>
          );
        })}
      </section>

      <div className="toolbar" role="toolbar" aria-label="View options">
        <div className="seg" aria-label="Show cards for">
          <button type="button" aria-pressed={prefs.person === "all"} onClick={() => updatePrefs({ person: "all" })}>Everyone</button>
          {people.map((person) => <button key={person.id} type="button" aria-pressed={prefs.person === person.id} onClick={() => updatePrefs({ person: person.id })}>{person.name}</button>)}
        </div>
        <div className="seg" aria-label="Layout">
          <button type="button" aria-pressed={prefs.view === "cards"} onClick={() => updatePrefs({ view: "cards" })}>By card</button>
          <button type="button" aria-pressed={prefs.view === "timeline"} onClick={() => updatePrefs({ view: "timeline" })}>Timeline</button>
        </div>
        {prefs.view === "cards" && (
          <button type="button" className="chip-toggle" aria-pressed={dueOnly} onClick={() => setDueOnly(!dueOnly)}>Due soon <span className="count num">{due.length}</span></button>
        )}
        <input className="search" type="search" placeholder="Search cards, notes, last digits" aria-label="Search cards, notes, or last digits" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      <main style={{ display: "grid", gap: 14 }}>
        {prefs.view === "cards" ? (
          <>
            {dueOnly && (due.length ? (
              <div className="due-list">
                {due.map((item, index) => {
                  const text = dueText(portfolio, item);
                  const accountId = item.kind === "credit" ? null : item.account.id;
                  const slug = item.kind === "credit" ? portfolio.product(item.credit.productId)?.slug : null;
                  return (
                    <button key={index} type="button" className="due-item" onClick={() => {
                      if (accountId !== null) setPanel({ kind: "account", id: accountId });
                      else if (slug) document.getElementById(groupId(slug))?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}>
                      <span className="due-kind">{text.label}</span><span>{text.text}</span><span className="when">{text.when}</span>
                    </button>
                  );
                })}
              </div>
            ) : <div className="empty">Nothing is due in the next month.</div>)}

            <div className="legend">
              <span><span className="cell used"><CheckIcon /></span>Used</span>
              <span><span className="cell partial" style={{ width: 26 }}><span className="num" style={{ fontSize: 9 }}>$30</span></span>Partly used</span>
              <span><span className="cell" />Not used</span>
              <span><span className="cell off">–</span>Not enrolled</span>
              <span>Tap a box to mark it used. Press and hold (or right-click) for a partial amount or to mark it not enrolled.</span>
            </div>

            {!dueOnly && <PendingApplications {...groupProps} />}
            <CardGroups {...groupProps} />
            <OtherCards {...groupProps} />

            {!dueOnly && (
              <section className={`group ${prefs.history ? "" : "collapsed"}`} id="g-history">
                <button type="button" className="group-head" aria-expanded={prefs.history} onClick={() => updatePrefs({ history: !prefs.history })}>
                  <span className="caret" aria-hidden="true">▾</span><h2>History</h2>
                  <span className="meta">{history.filter((account) => account.status === "closed").length} closed · {history.filter((account) => account.status === "declined").length} declined · still counted for 5/24 and card numbers</span>
                </button>
                <div className="table-wrap">{prefs.history && <TimelineTable portfolio={portfolio} accounts={history} onOpenAccount={groupProps.onOpenAccount} />}</div>
              </section>
            )}
          </>
        ) : timeline.length ? (
          <section className="group">
            <div className="group-head"><h2>All cards, newest first</h2><span className="meta">{timeline.length} accounts</span></div>
            <div className="table-wrap"><TimelineTable portfolio={portfolio} accounts={timeline} onOpenAccount={groupProps.onOpenAccount} /></div>
          </section>
        ) : <div className="empty">No cards match.</div>}
      </main>

      {panel?.kind === "account" && (
        <AccountDrawer
          key={panel.id ?? "new"}
          portfolio={portfolio}
          accountId={panel.id}
          defaultPersonId={prefs.person === "all" ? viewerPerson?.id ?? 0 : prefs.person}
          today={today}
          onClose={() => setPanel(null)}
          onSave={saveAccount}
          onChangeProduct={changeProduct}
          onUndoChange={async () => {
            if (!selectedAccount || !selectedCurrent) return;
            const previous = portfolio.holdingsOf(selectedAccount.id).filter((holding) => holding.id !== selectedCurrent.id).pop();
            if (!previous) return;
            await write((ctx) => data.undoProductChange(ctx, selectedCurrent, previous), { success: "Product change removed", rethrow: true });
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
          onClose={() => setPanel(null)}
          onSaveProduct={(id, draft) => write((ctx) => data.saveProduct(ctx, id, draft))}
          onSaveCredit={(id, draft) => write((ctx) => data.saveCredit(ctx, id, draft), { success: id === null ? "Credit added" : undefined })}
          onDeleteCredit={(id) => write((ctx) => data.deleteCredit(ctx, id), { success: "Credit deleted" })}
          onToggleRule={(id, enabled) => write((ctx) => data.setRuleEnabled(ctx, id, enabled))}
          onAddPerson={(name) => write((ctx) => data.addPerson(ctx, { name }, people.length), { success: `Added ${name.trim()}` })}
          onInvite={async (email) => {
            const response = await fetch("/api/session", { method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" }, body: JSON.stringify({ action: "invite", email }) });
            const payload = await response.json();
            if (!response.ok) { notify(payload.error || "Couldn't send the invitation.", undefined, true); return; }
            setMembership({ ...membership, ...payload });
            notify(`Invited ${email}. They can sign in with that email now.`);
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
          heading={`${portfolio.product(menu.target.credit.productId)?.name} · ${portfolio.person(menu.target.holding.personId)?.name} #${menu.target.holding.number ?? "?"}`}
          onClose={() => setMenu(null)}
          onUse={(amountCents) => { setMenu(null); setUse(menu.target, amountCents, amountCents === null ? "Cleared" : amountCents >= menu.target.credit.amountCents ? "Marked used:" : `Logged ${money(amountCents)} of`); }}
          onEnroll={(enrolled) => { setMenu(null); setEnrolled(menu.target, enrolled); }}
        />
      )}

      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  );
}
