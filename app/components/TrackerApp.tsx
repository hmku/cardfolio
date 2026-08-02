"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Account = {
  id: number;
  owner: string;
  cardTypeId: number;
  cardName: string;
  issuer: string;
  kind: string;
  cardIndex: string | null;
  appliedOn: string | null;
  approvedOn: string | null;
  openedHow: string | null;
  offer: string | null;
  annualFee: number;
  bonusReceived: number;
  status: "active" | "closed" | "pending" | "declined";
  closedOn: string | null;
  closedHow: string | null;
};

type CardType = {
  id: number;
  name: string;
  issuer: string;
  kind: string;
  annualFee: number;
  accountCount: number;
  benefitCount: number;
};

type Benefit = {
  id: number;
  cardTypeId: number;
  cardName: string;
  name: string;
  amount: number;
  frequency: string;
};

type Usage = {
  id: number;
  accountId: number;
  benefitId: number;
  periodKey: string;
  used: number;
  usedOn: string | null;
};

type AppData = {
  accounts: Account[];
  cardTypes: CardType[];
  benefits: Benefit[];
  usages: Usage[];
  source: { spreadsheetId: string; migratedAt: string };
};

type View = "overview" | "cards" | "credits";
type Modal = "account" | "cardType" | null;

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function formatDate(value: string | null) {
  if (!value) return "—";
  return shortDate.format(new Date(`${value}T12:00:00`));
}

function initials(value: string) {
  return value.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function currentPeriod(frequency: string) {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const key = frequency.toLowerCase();
  if (key.includes("month")) return `${year}-${String(month).padStart(2, "0")}`;
  if (key.includes("quarter")) return `${year}-Q${Math.ceil(month / 3)}`;
  if (key.includes("biannual")) return `${year}-H${month <= 6 ? 1 : 2}`;
  if (key.includes("anniversary")) return `${year}-anniversary`;
  return String(year);
}

function nextReview(account: Account) {
  if (!account.approvedOn) return null;
  const opened = new Date(`${account.approvedOn}T12:00:00`);
  const today = new Date();
  const review = new Date(today.getFullYear(), opened.getMonth(), opened.getDate());
  if (review.getTime() < today.getTime() - 1000 * 60 * 60 * 24 * 45) review.setFullYear(review.getFullYear() + 1);
  return review;
}

function daysUntil(date: Date) {
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

export function TrackerApp() {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("overview");
  const [owner, setOwner] = useState("Harrison");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [saving, setSaving] = useState(false);
  const [expandedBenefit, setExpandedBenefit] = useState<number | null>(null);
  const [visibleCards, setVisibleCards] = useState(20);

  useEffect(() => {
    fetch("/api/data")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load your tracker");
        setData(payload);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load your tracker"));
  }, []);

  const owners = useMemo(() => data ? [...new Set(data.accounts.map((account) => account.owner))] : [], [data]);
  const ownerAccounts = useMemo(() => {
    if (!data) return [];
    return owner === "All" ? data.accounts : data.accounts.filter((account) => account.owner === owner);
  }, [data, owner]);
  const approvedAccounts = ownerAccounts.filter((account) => Boolean(account.approvedOn));
  const activeAccounts = ownerAccounts.filter((account) => account.status === "active");
  const personalWindow = approvedAccounts.filter((account) => {
    if (account.kind !== "personal" || account.openedHow?.trim().toLowerCase() === "downgraded" || !account.approvedOn) return false;
    return new Date(account.approvedOn).getTime() >= Date.now() - 730 * 86_400_000;
  });
  const nextDrop = [...personalWindow]
    .sort((a, b) => String(a.approvedOn).localeCompare(String(b.approvedOn)))[0];
  const annualFees = activeAccounts.reduce((total, account) => total + Number(account.annualFee), 0);

  const reviewQueue = useMemo(() => activeAccounts
    .filter((account) => account.annualFee > 0)
    .map((account) => ({ account, review: nextReview(account) }))
    .filter((item): item is { account: Account; review: Date } => Boolean(item.review))
    .sort((a, b) => a.review.getTime() - b.review.getTime()), [activeAccounts]);

  const benefitSummaries = useMemo(() => {
    if (!data) return [];
    return data.benefits.map((benefit) => {
      const eligible = activeAccounts.filter((account) => account.cardTypeId === benefit.cardTypeId);
      const periodKey = currentPeriod(benefit.frequency);
      const accountRows = eligible.map((account) => {
        const usage = data.usages.find((row) => row.benefitId === benefit.id && row.accountId === account.id && row.periodKey === periodKey);
        return { account, used: Boolean(usage?.used), usage };
      });
      return { benefit, periodKey, accounts: accountRows, used: accountRows.filter((row) => row.used).length, total: accountRows.length };
    }).filter((summary) => summary.total > 0);
  }, [data, activeAccounts]);

  const creditsUsed = benefitSummaries.reduce((total, summary) => total + summary.used, 0);
  const creditsTotal = benefitSummaries.reduce((total, summary) => total + summary.total, 0);

  async function post(payload: Record<string, unknown>) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Unable to save changes");
      setData(next);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save changes");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const cardType = data?.cardTypes.find((item) => item.id === Number(values.cardTypeId));
    const saved = await post({ action: "createAccount", ...values, annualFee: cardType?.annualFee || 0, kind: cardType?.kind || "personal" });
    if (saved) setModal(null);
  }

  async function submitCardType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saved = await post({ action: "createCardType", ...Object.fromEntries(new FormData(event.currentTarget)) });
    if (saved) setModal(null);
  }

  async function closeAccount(account: Account) {
    const today = new Date().toISOString().slice(0, 10);
    await post({ action: "closeAccount", accountId: account.id, closedOn: today, closedHow: "closed in Cardfolio" });
  }

  const filteredCards = ownerAccounts.filter((account) => {
    const matchesStatus = status === "all" || account.status === status;
    const haystack = `${account.cardName} ${account.issuer} ${account.offer || ""}`.toLowerCase();
    return matchesStatus && haystack.includes(search.toLowerCase());
  });

  if (!data && !error) {
    return (
      <main className="loading-screen" aria-live="polite">
        <div className="loading-mark">C</div>
        <p>Organizing your card portfolio…</p>
      </main>
    );
  }

  if (!data) {
    return <main className="loading-screen"><div className="error-card"><strong>We couldn’t open Cardfolio.</strong><span>{error}</span><button onClick={() => location.reload()}>Try again</button></div></main>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("overview")} aria-label="Cardfolio home">
          <span className="brand-mark">C</span>
          <span>cardfolio</span>
        </button>
        <nav aria-label="Main navigation">
          <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}><span>⌂</span>Overview</button>
          <button className={view === "cards" ? "active" : ""} onClick={() => setView("cards")}><span>▣</span>Cards</button>
          <button className={view === "credits" ? "active" : ""} onClick={() => setView("credits")}><span>✓</span>Credits</button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sync-note"><span className="sync-dot" /> Migrated Aug 2, 2026</div>
          <div className="profile-chip"><span className="avatar">HK</span><span><strong>Harrison Ku</strong><small>Portfolio owner</small></span></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs"><span>Portfolio</span><b>/</b><strong>{view.charAt(0).toUpperCase() + view.slice(1)}</strong></div>
          <div className="top-actions">
            <label className="owner-picker"><span>Viewing</span><select value={owner} onChange={(event) => setOwner(event.target.value)}><option>All</option>{owners.map((name) => <option key={name}>{name}</option>)}</select></label>
            <button className="icon-button" title="Search cards" onClick={() => { setView("cards"); setTimeout(() => document.getElementById("card-search")?.focus(), 20); }}>⌕</button>
            <button className="primary-button" onClick={() => setModal("account")}><span>＋</span>Add card</button>
          </div>
        </header>

        {error && <div className="toast" role="alert">{error}<button onClick={() => setError("")}>×</button></div>}

        {view === "overview" && (
          <section className="page page-overview">
            <div className="hero-heading">
              <div><p className="eyebrow">Sunday, August 2</p><h1>Your portfolio, at a glance.</h1><p>Stay ahead of annual fees, bank rules, and credits before they expire.</p></div>
              <div className="hero-orbit" aria-hidden="true"><span>{activeAccounts.length}</span><small>open</small></div>
            </div>

            <div className="metric-grid">
              <article className="metric-card"><div className="metric-icon rose">▣</div><div><span>Active cards</span><strong>{activeAccounts.length}</strong><small>{approvedAccounts.length} approved all-time</small></div></article>
              <article className="metric-card"><div className="metric-icon blue">5</div><div><span>5/24 status</span><strong>{personalWindow.length}<em>/ 5</em></strong><small>{nextDrop ? `Next drop ${formatDate(new Date(new Date(`${nextDrop.approvedOn}T12:00:00`).setDate(new Date(`${nextDrop.approvedOn}T12:00:00`).getDate() + 730)).toISOString().slice(0, 10))}` : "No cards in window"}</small></div></article>
              <article className="metric-card"><div className="metric-icon cream">$</div><div><span>Annual fees</span><strong>{money.format(annualFees)}</strong><small>Across open cards</small></div></article>
              <article className="metric-card"><div className="metric-icon mint">✓</div><div><span>Credits used</span><strong>{creditsUsed}<em>/ {creditsTotal}</em></strong><small>This benefit period</small></div></article>
            </div>

            <div className="dashboard-grid">
              <article className="panel review-panel">
                <div className="panel-heading"><div><p className="eyebrow">Needs attention</p><h2>Annual fee watchlist</h2></div><button className="text-button" onClick={() => { setStatus("active"); setView("cards"); }}>View cards →</button></div>
                <div className="review-list">
                  {reviewQueue.slice(0, 5).map(({ account, review }) => {
                    const days = daysUntil(review);
                    return <div className="review-row" key={account.id}><span className={`issuer-badge ${account.issuer.replace(/\s/g, "").toLowerCase()}`}>{initials(account.issuer)}</span><div className="review-card-name"><strong>{account.cardName}{account.cardIndex ? ` ·${account.cardIndex}` : ""}</strong><span>{account.owner} · {money.format(account.annualFee)} annual fee</span></div><div className={`date-pill ${days <= 45 ? "urgent" : ""}`}><strong>{days <= 0 ? `${Math.abs(days)}d past` : `${days}d`}</strong><span>{shortDate.format(review)}</span></div><button className="row-action" onClick={() => closeAccount(account)} disabled={saving}>Close</button></div>;
                  })}
                  {reviewQueue.length === 0 && <div className="empty-state">No annual fee reviews are coming up.</div>}
                </div>
              </article>

              <article className="panel velocity-panel">
                <div className="panel-heading"><div><p className="eyebrow">Bank rules</p><h2>Your 5/24 runway</h2></div><span className="count-badge">{personalWindow.length} of 5</span></div>
                <div className="five-track" aria-label={`${personalWindow.length} of 5 Chase slots used`}>{[0, 1, 2, 3, 4].map((slot) => <span key={slot} className={slot < personalWindow.length ? "filled" : ""}>{slot < personalWindow.length ? "✓" : slot + 1}</span>)}</div>
                <p className="runway-copy">{personalWindow.length >= 5 ? "You’re at 5/24. The next personal-card slot opens when the oldest approval rolls off." : `You have ${5 - personalWindow.length} personal-card ${5 - personalWindow.length === 1 ? "slot" : "slots"} available.`}</p>
                {nextDrop && <div className="next-drop"><span className="calendar-chip">{new Date(`${nextDrop.approvedOn}T12:00:00`).toLocaleString("en-US", { month: "short" }).toUpperCase()}<strong>{new Date(`${nextDrop.approvedOn}T12:00:00`).getDate()}</strong></span><span><small>Next card drops off</small><strong>{nextDrop.cardName}</strong><em>{formatDate(new Date(new Date(`${nextDrop.approvedOn}T12:00:00`).setDate(new Date(`${nextDrop.approvedOn}T12:00:00`).getDate() + 730)).toISOString().slice(0, 10))}</em></span></div>}
              </article>
            </div>

            <article className="panel credits-preview">
              <div className="panel-heading"><div><p className="eyebrow">Use it or lose it</p><h2>Credits in progress</h2></div><button className="text-button" onClick={() => setView("credits")}>Manage all credits →</button></div>
              <div className="credit-preview-grid">
                {benefitSummaries.slice(0, 4).map((summary) => {
                  const percent = summary.total ? Math.round(summary.used / summary.total * 100) : 0;
                  return <button className="credit-preview-card" key={summary.benefit.id} onClick={() => { setExpandedBenefit(summary.benefit.id); setView("credits"); }}><div><span className="mini-card-mark">{initials(summary.benefit.cardName)}</span><span><strong>{summary.benefit.name}</strong><small>{summary.benefit.cardName} · {summary.benefit.frequency}</small></span><b>{money.format(summary.benefit.amount)}</b></div><div className="progress-track"><span style={{ width: `${percent}%` }} /></div><p><span>{summary.used} of {summary.total} used</span><strong>{percent}%</strong></p></button>;
                })}
              </div>
            </article>
          </section>
        )}

        {view === "cards" && (
          <section className="page">
            <div className="section-heading"><div><p className="eyebrow">The complete ledger</p><h1>Cards</h1><p>{filteredCards.length} records across {data.cardTypes.length} card types.</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => setModal("cardType")}>＋ New card type</button><button className="primary-button" onClick={() => setModal("account")}>＋ Add card</button></div></div>
            <div className="table-toolbar"><div className="search-field"><span>⌕</span><input id="card-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search cards, issuers, or offers" /></div><div className="segmented" aria-label="Filter cards by status">{["all", "active", "closed", "pending", "declined"].map((value) => <button key={value} className={status === value ? "active" : ""} onClick={() => { setStatus(value); setVisibleCards(20); }}>{value}</button>)}</div></div>
            <div className="cards-table-wrap"><table className="cards-table"><thead><tr><th>Card</th><th>Owner</th><th>Status</th><th>Approved</th><th>Offer</th><th>Annual fee</th><th>Next action</th><th /></tr></thead><tbody>{filteredCards.slice(0, visibleCards).map((account) => { const review = account.status === "active" ? nextReview(account) : null; const days = review ? daysUntil(review) : null; return <tr key={account.id}><td><div className="table-card"><span className={`issuer-badge ${account.issuer.replace(/\s/g, "").toLowerCase()}`}>{initials(account.issuer)}</span><span><strong>{account.cardName}{account.cardIndex ? ` ·${account.cardIndex}` : ""}</strong><small>{account.issuer} · {account.kind}</small></span></div></td><td>{account.owner}</td><td><span className={`status-pill ${account.status}`}>{account.status}</span></td><td>{formatDate(account.approvedOn || account.appliedOn)}</td><td className="offer-cell">{account.offer || "—"}</td><td>{money.format(account.annualFee)}</td><td>{review ? <span className={days !== null && days <= 45 ? "action-date urgent-text" : "action-date"}>{days !== null && days <= 0 ? "Review now" : `${days}d to review`}</span> : account.closedHow || "—"}</td><td>{account.status === "active" && <button className="kebab" onClick={() => closeAccount(account)} title="Mark this card closed" disabled={saving}>Close</button>}</td></tr>; })}</tbody></table>{filteredCards.length === 0 && <div className="empty-state">No cards match these filters.</div>}</div>
            {visibleCards < filteredCards.length && <button className="load-more" onClick={() => setVisibleCards((count) => count + 30)}>Show more records</button>}
          </section>
        )}

        {view === "credits" && (
          <section className="page">
            <div className="section-heading"><div><p className="eyebrow">Recurring benefits</p><h1>Credits</h1><p>Mark usage against the exact card that received each benefit.</p></div><div className="credit-total"><span>Available value</span><strong>{money.format(benefitSummaries.reduce((sum, item) => sum + item.benefit.amount * item.total, 0))}</strong><small>across current periods</small></div></div>
            <div className="credits-layout">
              <div className="credit-list">
                {benefitSummaries.map((summary) => {
                  const percent = summary.total ? Math.round(summary.used / summary.total * 100) : 0;
                  const expanded = expandedBenefit === summary.benefit.id;
                  return <article className={`benefit-card ${expanded ? "expanded" : ""}`} key={summary.benefit.id}><button className="benefit-summary" onClick={() => setExpandedBenefit(expanded ? null : summary.benefit.id)} aria-expanded={expanded}><span className="benefit-symbol">{initials(summary.benefit.cardName)}</span><span className="benefit-title"><small>{summary.benefit.cardName}</small><strong>{summary.benefit.name}</strong><em>{summary.benefit.frequency} · {summary.periodKey}</em></span><span className="benefit-value">{money.format(summary.benefit.amount)}<small>per card</small></span><span className="benefit-progress"><b>{summary.used}/{summary.total}</b><span className="progress-track"><i style={{ width: `${percent}%` }} /></span><small>{summary.total - summary.used} remaining</small></span><span className="expand-icon">⌄</span></button>{expanded && <div className="benefit-accounts"><div className="benefit-explainer"><strong>Usage by card</strong><span>Tap an account to mark this period used or unused.</span></div>{summary.accounts.map(({ account, used }) => <button key={account.id} className={`usage-row ${used ? "used" : ""}`} disabled={saving} onClick={() => post({ action: "toggleUsage", accountId: account.id, benefitId: summary.benefit.id, periodKey: summary.periodKey, used: !used })}><span className="usage-check">{used ? "✓" : ""}</span><span><strong>{account.owner} · {account.cardName}{account.cardIndex ? ` ${account.cardIndex}` : ""}</strong><small>Opened {formatDate(account.approvedOn)} · {money.format(account.annualFee)} fee</small></span><em>{used ? "Used" : "Mark used"}</em></button>)}</div>}</article>;
                })}
              </div>
              <aside className="credits-aside"><p className="eyebrow">Current period</p><h2>{creditsUsed} of {creditsTotal} credits logged</h2><div className="donut" style={{ "--progress": `${creditsTotal ? creditsUsed / creditsTotal * 360 : 0}deg` } as React.CSSProperties}><span><strong>{creditsTotal ? Math.round(creditsUsed / creditsTotal * 100) : 0}%</strong><small>complete</small></span></div><p>Monthly, quarterly, and half-year credits automatically reset into a new period.</p><div className="aside-rule" /><span className="aside-kicker">Up next</span>{benefitSummaries.filter((item) => item.used < item.total).slice(0, 3).map((item) => <button key={item.benefit.id} onClick={() => setExpandedBenefit(item.benefit.id)}><span>{initials(item.benefit.cardName)}</span><strong>{item.benefit.name}</strong><em>{item.total - item.used} left</em></button>)}</aside>
            </div>
          </section>
        )}
      </main>

      {modal && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close" onClick={() => setModal(null)} aria-label="Close">×</button>{modal === "account" ? <><p className="eyebrow">Portfolio entry</p><h2 id="modal-title">Add a card</h2><p>Record a new application or an approved card.</p><form onSubmit={submitAccount}><label><span>Card type</span><select name="cardTypeId" required defaultValue=""><option value="" disabled>Select a card</option>{data.cardTypes.map((card) => <option key={card.id} value={card.id}>{card.name} · {card.issuer}</option>)}</select></label><div className="form-grid"><label><span>Owner</span><select name="owner" defaultValue={owner === "All" ? "Harrison" : owner}>{owners.map((name) => <option key={name}>{name}</option>)}</select></label><label><span>Opened via</span><select name="openedHow" defaultValue="applied"><option>applied</option><option>referred</option><option>nll</option><option>downgraded</option><option>upgraded</option></select></label><label><span>Applied</span><input type="date" name="appliedOn" defaultValue={new Date().toISOString().slice(0, 10)} /></label><label><span>Approved</span><input type="date" name="approvedOn" /></label></div><label><span>Signup offer</span><input name="offer" placeholder="e.g. 100k / $5k / 3mo" /></label><label className="check-label"><input type="checkbox" name="bonusReceived" /><span>Signup bonus received</span></label><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add card"}</button></div></form></> : <><p className="eyebrow">Reusable definition</p><h2 id="modal-title">New card type</h2><p>Define the card once, then attach future applications and benefits to it.</p><form onSubmit={submitCardType}><label><span>Card name</span><input name="name" required placeholder="e.g. Sapphire Preferred" /></label><div className="form-grid"><label><span>Issuer</span><input name="issuer" required placeholder="e.g. Chase" /></label><label><span>Card kind</span><select name="kind" defaultValue="personal"><option value="personal">Personal</option><option value="business">Business</option><option value="other">Other</option></select></label><label><span>Annual fee</span><input name="annualFee" type="number" min="0" defaultValue="0" /></label><label><span>Benefit frequency</span><select name="benefitFrequency" defaultValue="calendar year"><option>calendar year</option><option>anniversary</option><option>biannual</option><option>quarter</option><option>monthly</option></select></label></div><div className="form-grid"><label><span>First benefit (optional)</span><input name="benefitName" placeholder="e.g. Hotel credit" /></label><label><span>Benefit amount</span><input name="benefitAmount" type="number" min="0" defaultValue="0" /></label></div><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Create card type"}</button></div></form></>}</section></div>}
    </div>
  );
}

