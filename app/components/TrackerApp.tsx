"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { annualFeePayments, bonusDeadline, creditPeriod, dateAtNoon, daysUntilDate, fiveTwentyFourAccounts } from "../lib/portfolio";

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
  bonusAmount: string | null;
  spendRequirement: number | null;
  bonusPeriodMonths: number | null;
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
  members: { user_id: string; email: string; role: "owner" | "member"; created_at: string }[];
  invitations: { id: string; email: string; role: "owner" | "member"; accepted_at: string | null; created_at: string }[];
  currentUser: { email: string; role: "owner" | "member" };
  source: { spreadsheetId: string; migratedAt: string };
};

type View = "overview" | "cards" | "types" | "credits";
type Modal = "account" | "cardType" | "editCardType" | "access" | null;

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

function formatDate(value: string | null) {
  if (!value) return "—";
  return shortDate.format(new Date(`${value}T12:00:00`));
}

function initials(value: string) {
  return value.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function formatBonusAmount(value: string | null) {
  if (!value) return "—";
  return value
    .replace(/(\d+(?:\.\d+)?k)/i, "$1 points")
    .replace(/fnc/gi, "FNC")
    .replace(/\+/g, " + ");
}

function nextReview(account: Account) {
  if (!account.approvedOn) return null;
  const opened = new Date(`${account.approvedOn}T12:00:00`);
  const today = new Date();
  const review = new Date(today.getFullYear(), opened.getMonth(), opened.getDate());
  if (review.getTime() < today.getTime() - 1000 * 60 * 60 * 24 * 45) review.setFullYear(review.getFullYear() + 1);
  return review;
}

export function TrackerApp({ accessToken, userEmail, onSignOut }: { accessToken: string; userEmail: string; onSignOut: () => Promise<void> }) {
  const [referenceTime] = useState(() => Date.now());
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("overview");
  const [owner, setOwner] = useState("All");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [typeSearch, setTypeSearch] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [selectedCardType, setSelectedCardType] = useState<CardType | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedBenefit, setExpandedBenefit] = useState<number | null>(null);
  const [visibleCards, setVisibleCards] = useState(20);

  useEffect(() => {
    fetch("/api/data", { headers: { authorization: `Bearer ${accessToken}` } })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load your tracker");
        setData(payload);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load your tracker"));
  }, [accessToken]);

  const owners = useMemo(() => data ? [...new Set(data.accounts.map((account) => account.owner))] : [], [data]);
  const ownerAccounts = useMemo(() => {
    if (!data) return [];
    return owner === "All" ? data.accounts : data.accounts.filter((account) => account.owner === owner);
  }, [data, owner]);
  const referenceDate = useMemo(() => new Date(referenceTime), [referenceTime]);
  const approvedAccounts = ownerAccounts.filter((account) => Boolean(account.approvedOn));
  const activeAccounts = ownerAccounts.filter((account) => Boolean(account.approvedOn) && !account.closedOn);
  const fiveTwentyFourByOwner = owners.map((name) => {
    const window = fiveTwentyFourAccounts((data?.accounts ?? []).filter((account) => account.owner === name), referenceDate);
    const nextDrop = [...window].sort((a, b) => String(a.approvedOn).localeCompare(String(b.approvedOn)))[0] || null;
    return { owner: name, window, nextDrop };
  });
  const selectedFiveTwentyFour = owner === "All"
    ? null
    : fiveTwentyFourByOwner.find((item) => item.owner === owner) || null;
  const annualFees = activeAccounts.reduce((total, account) => total + Number(account.annualFee), 0);
  const historicalFees = approvedAccounts.reduce((total, account) => total + annualFeePayments(account, referenceDate).total, 0);

  const bonusQueue = activeAccounts
    .filter((account) => Boolean(account.bonusAmount) && !account.bonusReceived)
    .map((account) => ({ account, deadline: bonusDeadline(account.approvedOn, account.bonusPeriodMonths) }))
    .filter((item): item is { account: Account; deadline: Date } => Boolean(item.deadline))
    .sort((a, b) => a.deadline.getTime() - b.deadline.getTime());

  const reviewQueue = activeAccounts
    .filter((account) => account.annualFee > 0)
    .map((account) => ({ account, review: nextReview(account) }))
    .filter((item): item is { account: Account; review: Date } => Boolean(item.review))
    .sort((a, b) => a.review.getTime() - b.review.getTime());

  const benefitSummaries = data ? data.benefits.map((benefit) => {
      const eligible = activeAccounts.filter((account) => account.cardTypeId === benefit.cardTypeId);
      const accountRows = eligible.map((account) => {
        const period = creditPeriod(benefit.frequency, account.approvedOn, referenceDate);
        const compatibilityKeys = new Set([period.key]);
        if (benefit.frequency.toLowerCase().includes("anniversary")) compatibilityKeys.add(`${referenceDate.getFullYear()}-anniversary`);
        const usage = data.usages.find((row) => row.benefitId === benefit.id && row.accountId === account.id && compatibilityKeys.has(row.periodKey));
        return { account, period, periodKey: period.key, used: Boolean(usage?.used), usage };
      }).sort((a, b) => a.period.end.getTime() - b.period.end.getTime());
      const outstanding = accountRows.filter((row) => !row.used);
      const nextDue = (outstanding[0] || accountRows[0])?.period.end || new Date(8640000000000000);
      return { benefit, accounts: accountRows, used: accountRows.filter((row) => row.used).length, total: accountRows.length, nextDue };
    }).filter((summary) => summary.total > 0).sort((a, b) => a.nextDue.getTime() - b.nextDue.getTime()) : [];

  const urgentCreditInstances = benefitSummaries
    .flatMap((summary) => summary.accounts.map((row) => ({ ...row, benefit: summary.benefit })))
    .filter((item) => !item.used)
    .sort((a, b) => a.period.end.getTime() - b.period.end.getTime());

  const creditsUsed = benefitSummaries.reduce((total, summary) => total + summary.used, 0);
  const creditsTotal = benefitSummaries.reduce((total, summary) => total + summary.total, 0);

  async function post(payload: Record<string, unknown>) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/data", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` }, body: JSON.stringify(payload) });
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

  async function submitCardTypeEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCardType) return;
    const saved = await post({
      action: "updateCardType",
      cardTypeId: selectedCardType.id,
      ...Object.fromEntries(new FormData(event.currentTarget)),
    });
    if (saved) {
      setModal(null);
      setSelectedCardType(null);
    }
  }

  async function submitInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const saved = await post({ action: "inviteMember", ...values });
    if (saved) event.currentTarget.reset();
  }

  async function closeAccount(account: Account) {
    const today = new Date().toISOString().slice(0, 10);
    await post({ action: "closeAccount", accountId: account.id, closedOn: today, closedHow: "closed in Cardfolio" });
  }

  const filteredCards = ownerAccounts.filter((account) => {
    const matchesStatus = status === "all" || account.status === status;
    const haystack = `${account.cardName} ${account.issuer} ${account.bonusAmount || ""} ${account.offer || ""}`.toLowerCase();
    return matchesStatus && haystack.includes(search.toLowerCase());
  });
  const filteredCardTypes = (data?.cardTypes ?? []).filter((card) => {
    const benefits = (data?.benefits ?? []).filter((benefit) => benefit.cardTypeId === card.id);
    return `${card.name} ${card.issuer} ${benefits.map((benefit) => benefit.name).join(" ")}`
      .toLowerCase()
      .includes(typeSearch.toLowerCase());
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
          <button className={view === "types" ? "active" : ""} onClick={() => setView("types")}><span>◇</span>Card types</button>
          <button className={view === "credits" ? "active" : ""} onClick={() => setView("credits")}><span>✓</span>Credits</button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sync-note"><span className="sync-dot" /> Secure cloud sync</div>
          <button className="profile-chip" onClick={() => setModal("access")} title="Manage household access"><span className="avatar">{initials(userEmail)}</span><span><strong>{userEmail}</strong><small>{data.currentUser.role === "owner" ? "Portfolio owner" : "Household member"}</small></span></button>
          <button className="signout-button" onClick={() => void onSignOut()}>Sign out</button>
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
              <div><p className="eyebrow">{referenceDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p><h1>Your portfolio, at a glance.</h1><p>Stay ahead of signup bonuses, annual fees, bank rules, and credits before they expire.</p></div>
              <div className="hero-orbit" aria-hidden="true"><span>{activeAccounts.length}</span><small>open</small></div>
            </div>

            <div className="metric-grid">
              <article className="metric-card"><div className="metric-icon rose">▣</div><div><span>Active cards</span><strong>{activeAccounts.length}</strong><small>{approvedAccounts.length} approved all-time</small></div></article>
              <article className="metric-card"><div className="metric-icon blue">★</div><div><span>Signup bonuses</span><strong>{bonusQueue.length}</strong><small>{bonusQueue.length ? "Still need to hit the spend" : "All current bonuses complete"}</small></div></article>
              <article className="metric-card"><div className="metric-icon cream">$</div><div><span>Annual fees</span><strong>{money.format(annualFees)}</strong><small>{money.format(historicalFees)} paid across card history</small></div></article>
              <article className="metric-card"><div className="metric-icon mint">✓</div><div><span>Credits used</span><strong>{creditsUsed}<em>/ {creditsTotal}</em></strong><small>This benefit period</small></div></article>
            </div>

            <div className="dashboard-grid">
              <article className="panel review-panel">
                <div className="panel-heading"><div><p className="eyebrow">Needs attention</p><h2>Annual fee watchlist</h2></div><button className="text-button" onClick={() => { setStatus("active"); setView("cards"); }}>View cards →</button></div>
                <div className="review-list">
                  {reviewQueue.slice(0, 5).map(({ account, review }) => {
                    const days = daysUntilDate(review, referenceDate);
                    return <div className="review-row" key={account.id}><span className={`issuer-badge ${account.issuer.replace(/\s/g, "").toLowerCase()}`}>{initials(account.issuer)}</span><div className="review-card-name"><strong>{account.cardName}{account.cardIndex ? ` ·${account.cardIndex}` : ""}</strong><span>{account.owner} · {money.format(account.annualFee)} annual fee</span></div><div className={`date-pill ${days <= 45 ? "urgent" : ""}`}><strong>{days <= 0 ? `${Math.abs(days)}d past` : `${days}d`}</strong><span>{shortDate.format(review)}</span></div><button className="row-action" onClick={() => closeAccount(account)} disabled={saving}>Close</button></div>;
                  })}
                  {reviewQueue.length === 0 && <div className="empty-state">No annual fee reviews are coming up.</div>}
                </div>
              </article>

              <article className="panel velocity-panel">
                <div className="panel-heading"><div><p className="eyebrow">Bank rules</p><h2>5/24 by cardholder</h2></div>{selectedFiveTwentyFour && <span className="count-badge">{selectedFiveTwentyFour.window.length} of 5</span>}</div>
                <div className="household-runways">
                  {fiveTwentyFourByOwner.map((item) => {
                    const dropDate = item.nextDrop?.approvedOn ? new Date(dateAtNoon(item.nextDrop.approvedOn).getTime() + 730 * 86_400_000) : null;
                    return <div className="owner-runway" key={item.owner}><div><span className={`owner-badge ${item.owner.toLowerCase()}`}>{initials(item.owner)}</span><strong>{item.owner}</strong><em>{item.window.length}/24</em></div><div className="five-track" aria-label={`${item.owner}: ${item.window.length} of 5 Chase slots used`}>{[0, 1, 2, 3, 4].map((slot) => <span key={slot} className={slot < item.window.length ? "filled" : ""}>{slot < item.window.length ? "✓" : slot + 1}</span>)}</div><p>{item.window.length >= 5 ? "At 5/24" : `${5 - item.window.length} slots available`}{dropDate ? ` · next drop ${formatDate(dropDate.toISOString().slice(0, 10))}` : ""}</p></div>;
                  })}
                </div>
              </article>
            </div>

            <article className="panel bonus-panel">
              <div className="panel-heading"><div><p className="eyebrow">Minimum spend</p><h2>Signup bonuses in progress</h2></div><span className="count-badge">{bonusQueue.length} open</span></div>
              <div className="bonus-list">
                {bonusQueue.map(({ account, deadline }) => {
                  const days = daysUntilDate(deadline, referenceDate);
                  return <div className="bonus-row" key={account.id}><span className={`owner-badge ${account.owner.toLowerCase()}`}>{initials(account.owner)}</span><span className="bonus-card"><strong>{account.cardName}{account.cardIndex ? ` ·${account.cardIndex}` : ""}</strong><small>{account.owner} · approved {formatDate(account.approvedOn)}</small></span><span className="bonus-term"><small>Bonus</small><strong>{formatBonusAmount(account.bonusAmount)}</strong></span><span className="bonus-term"><small>Spend</small><strong>{account.spendRequirement === null ? "—" : money.format(account.spendRequirement)}</strong></span><span className={`date-pill ${days <= 30 ? "urgent" : ""}`}><strong>{days < 0 ? `${Math.abs(days)}d past` : `${days}d left`}</strong><span>Due {formatDate(deadline.toISOString().slice(0, 10))}</span></span><button className="row-action" onClick={() => post({ action: "toggleBonus", accountId: account.id, received: true })} disabled={saving}>Mark hit</button></div>;
                })}
                {bonusQueue.length === 0 && <div className="empty-state">Every active signup bonus is marked complete.</div>}
              </div>
            </article>

            <article className="panel credits-preview">
              <div className="panel-heading"><div><p className="eyebrow">Use it or lose it</p><h2>Credits in progress</h2></div><button className="text-button" onClick={() => setView("credits")}>Manage all credits →</button></div>
              <div className="credit-preview-grid">
                {urgentCreditInstances.slice(0, 4).map((item) => <button className="credit-preview-card" key={`${item.benefit.id}-${item.account.id}`} onClick={() => { setExpandedBenefit(item.benefit.id); setView("credits"); }}><div><span className="mini-card-mark">{initials(item.benefit.cardName)}</span><span><strong>{item.benefit.name}</strong><small>{item.account.owner} · {item.benefit.cardName}</small></span><b>{money.format(item.benefit.amount)}</b></div><p className="credit-due"><span>{formatDate(item.period.start.toISOString().slice(0, 10))}–{formatDate(item.period.end.toISOString().slice(0, 10))}</span><strong>{daysUntilDate(item.period.end, referenceDate)}d left</strong></p></button>)}
              </div>
            </article>
          </section>
        )}

        {view === "cards" && (
          <section className="page">
            <div className="section-heading"><div><p className="eyebrow">The complete ledger</p><h1>Cards</h1><p>{filteredCards.length} records across {data.cardTypes.length} card types.</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => setModal("cardType")}>＋ New card type</button><button className="primary-button" onClick={() => setModal("account")}>＋ Add card</button></div></div>
            <div className="table-toolbar"><div className="search-field"><span>⌕</span><input id="card-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search cards, issuers, or offers" /></div><div className="segmented" aria-label="Filter cards by status">{["all", "active", "closed", "pending", "declined"].map((value) => <button key={value} className={status === value ? "active" : ""} onClick={() => { setStatus(value); setVisibleCards(20); }}>{value}</button>)}</div></div>
            <div className="cards-table-wrap"><table className="cards-table"><thead><tr><th>Card</th><th>Type</th><th>Status</th><th>Approved</th><th>Signup bonus</th><th>Annual fees</th><th>Next action</th><th /></tr></thead><tbody>{filteredCards.slice(0, visibleCards).map((account) => { const review = account.status === "active" ? nextReview(account) : null; const days = review ? daysUntilDate(review, referenceDate) : null; const paid = annualFeePayments(account, referenceDate); return <tr key={account.id}><td><div className="table-card"><span className={`owner-badge ${account.owner.toLowerCase()}`}>{initials(account.owner)}</span><span><strong>{account.cardName}{account.cardIndex ? ` ·${account.cardIndex}` : ""}</strong><small>{account.issuer} · {account.owner}</small></span></div></td><td><span className={`kind-pill ${account.kind.toLowerCase()}`}>{account.kind}</span></td><td><span className={`status-pill ${account.status}`}>{account.status}</span></td><td>{formatDate(account.approvedOn || account.appliedOn)}</td><td className="offer-cell">{account.bonusAmount ? <span className="structured-offer"><strong>{formatBonusAmount(account.bonusAmount)}</strong><small>{account.spendRequirement === null ? "No spend recorded" : `${money.format(account.spendRequirement)} spend`} · {account.bonusPeriodMonths || 3} months</small></span> : "—"}</td><td><span className="fee-history"><strong>{money.format(account.annualFee)}</strong><small>{paid.count ? `${paid.count} paid · ${money.format(paid.total)} total` : "No annual fee"}</small></span></td><td>{review ? <span className={days !== null && days <= 45 ? "action-date urgent-text" : "action-date"}>{days !== null && days <= 0 ? "Review now" : `${days}d to review`}</span> : account.closedHow || "—"}</td><td>{account.status === "active" && <button className="kebab" onClick={() => closeAccount(account)} title="Mark this card closed" disabled={saving}>Close</button>}</td></tr>; })}</tbody></table>{filteredCards.length === 0 && <div className="empty-state">No cards match these filters.</div>}</div>
            {visibleCards < filteredCards.length && <button className="load-more" onClick={() => setVisibleCards((count) => count + 30)}>Show more records</button>}
          </section>
        )}

        {view === "types" && (
          <section className="page">
            <div className="section-heading">
              <div><p className="eyebrow">Reusable definitions</p><h1>Card types</h1><p>Annual fees and benefits that apply to every instance of a card.</p></div>
              <button className="primary-button" onClick={() => setModal("cardType")}>＋ New card type</button>
            </div>
            <div className="type-metrics">
              <article><span>Card types</span><strong>{data.cardTypes.length}</strong></article>
              <article><span>Defined benefits</span><strong>{data.benefits.length}</strong></article>
              <article><span>Issuers</span><strong>{new Set(data.cardTypes.map((card) => card.issuer)).size}</strong></article>
              <article><span>Average annual fee</span><strong>{money.format(data.cardTypes.reduce((sum, card) => sum + Number(card.annualFee), 0) / Math.max(data.cardTypes.length, 1))}</strong></article>
            </div>
            <div className="types-toolbar">
              <div className="search-field"><span>⌕</span><input value={typeSearch} onChange={(event) => setTypeSearch(event.target.value)} placeholder="Search names, issuers, or benefits" /></div>
              <span>{filteredCardTypes.length} definitions</span>
            </div>
            <div className="card-type-grid">
              {filteredCardTypes.map((card) => {
                const cardBenefits = data.benefits.filter((benefit) => benefit.cardTypeId === card.id);
                const openCount = data.accounts.filter((account) => account.cardTypeId === card.id && account.approvedOn && !account.closedOn).length;
                return (
                  <article className="card-type-card" key={card.id}>
                    <div className="type-card-header">
                      <span className={`type-card-art ${card.issuer.replace(/\s/g, "").toLowerCase()}`}><b>{initials(card.name)}</b><small>{initials(card.issuer)}</small></span>
                      <span className="type-title"><small>{card.issuer}</small><strong>{card.name}</strong><em>{card.kind}</em></span>
                      <button onClick={() => { setSelectedCardType(card); setModal("editCardType"); }}>Edit</button>
                    </div>
                    <div className="type-facts"><span><small>Annual fee</small><strong>{money.format(card.annualFee)}</strong></span><span><small>Open now</small><strong>{openCount}</strong></span><span><small>All accounts</small><strong>{card.accountCount}</strong></span></div>
                    <div className="type-benefits">
                      <div><strong>Benefits</strong><span>{cardBenefits.length}</span></div>
                      {cardBenefits.length ? cardBenefits.map((benefit) => <div className="type-benefit-row" key={benefit.id}><span><strong>{benefit.name}</strong><small>{benefit.frequency}</small></span><b>{money.format(benefit.amount)}</b></div>) : <p>No benefits defined yet.</p>}
                    </div>
                  </article>
                );
              })}
            </div>
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
                  const firstPeriod = summary.accounts[0]?.period;
                  return <article className={`benefit-card ${expanded ? "expanded" : ""}`} key={summary.benefit.id}><button className="benefit-summary" onClick={() => setExpandedBenefit(expanded ? null : summary.benefit.id)} aria-expanded={expanded}><span className="benefit-symbol">{initials(summary.benefit.cardName)}</span><span className="benefit-title"><small>{summary.benefit.cardName}</small><strong>{summary.benefit.name}</strong><em>{summary.benefit.frequency}{firstPeriod ? ` · ${formatDate(firstPeriod.start.toISOString().slice(0, 10))}–${formatDate(firstPeriod.end.toISOString().slice(0, 10))}` : ""}</em></span><span className="benefit-value">{money.format(summary.benefit.amount)}<small>per card</small></span><span className="benefit-progress"><b>{summary.used}/{summary.total}</b><span className="progress-track"><i style={{ width: `${percent}%` }} /></span><small>{summary.total - summary.used} remaining · due {formatDate(summary.nextDue.toISOString().slice(0, 10))}</small></span><span className="expand-icon">⌄</span></button>{expanded && <div className="benefit-accounts"><div className="benefit-explainer"><strong>Usage by card</strong><span>Sorted by the deadline for each account’s current period.</span></div>{summary.accounts.map(({ account, period, periodKey, used }) => <button key={account.id} className={`usage-row ${used ? "used" : ""}`} disabled={saving} onClick={() => post({ action: "toggleUsage", accountId: account.id, benefitId: summary.benefit.id, periodKey, used: !used })}><span className="usage-check">{used ? "✓" : ""}</span><span><strong>{account.owner} · {account.cardName}{account.cardIndex ? ` ${account.cardIndex}` : ""}</strong><small>Available {formatDate(period.start.toISOString().slice(0, 10))} · use by {formatDate(period.end.toISOString().slice(0, 10))}</small></span><em>{used ? "Used" : `${daysUntilDate(period.end, referenceDate)}d left`}</em></button>)}</div>}</article>;
                })}
              </div>
              <aside className="credits-aside"><p className="eyebrow">Current period</p><h2>{creditsUsed} of {creditsTotal} credits logged</h2><div className="donut" style={{ "--progress": `${creditsTotal ? creditsUsed / creditsTotal * 360 : 0}deg` } as React.CSSProperties}><span><strong>{creditsTotal ? Math.round(creditsUsed / creditsTotal * 100) : 0}%</strong><small>complete</small></span></div><p>Credits are ordered by their inferred expiration dates. Monthly, quarterly, half-year, calendar-year, and anniversary periods reset automatically.</p><div className="aside-rule" /><span className="aside-kicker">Most urgent</span>{urgentCreditInstances.slice(0, 4).map((item) => <button key={`${item.benefit.id}-${item.account.id}`} onClick={() => setExpandedBenefit(item.benefit.id)}><span>{initials(item.benefit.cardName)}</span><strong>{item.account.owner} · {item.benefit.name}</strong><em>{daysUntilDate(item.period.end, referenceDate)}d</em></button>)}</aside>
            </div>
          </section>
        )}
      </main>

      {modal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <button className="modal-close" onClick={() => setModal(null)} aria-label="Close">×</button>
            {modal === "account" ? (
              <><p className="eyebrow">Portfolio entry</p><h2 id="modal-title">Add a card</h2><p>Record a new application or an approved card.</p><form onSubmit={submitAccount}><label><span>Card type</span><select name="cardTypeId" required defaultValue=""><option value="" disabled>Select a card</option>{data.cardTypes.map((card) => <option key={card.id} value={card.id}>{card.name} · {card.issuer}</option>)}</select></label><div className="form-grid"><label><span>Owner</span><select name="owner" defaultValue={owner === "All" ? "Harrison" : owner}>{owners.map((name) => <option key={name}>{name}</option>)}</select></label><label><span>Opened via</span><select name="openedHow" defaultValue="applied"><option>applied</option><option>referred</option><option>nll</option><option>downgraded</option><option>upgraded</option></select></label><label><span>Applied</span><input type="date" name="appliedOn" defaultValue={new Date().toISOString().slice(0, 10)} /></label><label><span>Approved</span><input type="date" name="approvedOn" /></label></div><div className="form-grid bonus-fields"><label><span>Bonus amount</span><input name="bonusAmount" placeholder="e.g. 100k points" /></label><label><span>Required spend ($)</span><input name="spendRequirement" type="number" min="0" placeholder="5000" /></label><label><span>Qualification period</span><select name="bonusPeriodMonths" defaultValue="3"><option value="3">3 months</option><option value="4">4 months</option><option value="6">6 months</option><option value="9">9 months</option><option value="12">12 months</option></select></label></div><p className="form-help">If no period is specified, Cardfolio uses three months.</p><label className="check-label"><input type="checkbox" name="bonusReceived" /><span>Signup bonus received</span></label><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add card"}</button></div></form></>
            ) : modal === "cardType" ? (
              <><p className="eyebrow">Reusable definition</p><h2 id="modal-title">New card type</h2><p>Define the card once, then attach future applications and benefits to it.</p><form onSubmit={submitCardType}><label><span>Card name</span><input name="name" required placeholder="e.g. Sapphire Preferred" /></label><div className="form-grid"><label><span>Issuer</span><input name="issuer" required placeholder="e.g. Chase" /></label><label><span>Card kind</span><select name="kind" defaultValue="personal"><option value="personal">Personal</option><option value="business">Business</option><option value="other">Other</option></select></label><label><span>Annual fee</span><input name="annualFee" type="number" min="0" defaultValue="0" /></label><label><span>Benefit frequency</span><select name="benefitFrequency" defaultValue="calendar year"><option>calendar year</option><option>anniversary</option><option>biannual</option><option>quarter</option><option>monthly</option></select></label></div><div className="form-grid"><label><span>First benefit (optional)</span><input name="benefitName" placeholder="e.g. Hotel credit" /></label><label><span>Benefit amount</span><input name="benefitAmount" type="number" min="0" defaultValue="0" /></label></div><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Create card type"}</button></div></form></>
            ) : modal === "access" ? (
              <><p className="eyebrow">Household security</p><h2 id="modal-title">Manage access</h2><p>Cardfolio is shared only with the email addresses listed here.</p><div className="member-list">{data.members.map((member) => <div key={member.user_id}><span className="avatar">{initials(member.email)}</span><span><strong>{member.email}</strong><small>{member.role}</small></span><em>Active</em></div>)}{data.invitations.map((invitation) => <div key={invitation.id}><span className="avatar pending">＋</span><span><strong>{invitation.email}</strong><small>{invitation.role}</small></span><em>Invited</em></div>)}</div>{data.currentUser.role === "owner" ? <form onSubmit={submitInvitation}><label><span>Authorize another email</span><input name="email" type="email" required placeholder="sophia@example.com" /></label><p className="form-help">They won’t receive an email yet. When they request a Cardfolio sign-in link with this address, access will activate automatically.</p><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Done</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Authorize email"}</button></div></form> : <div className="form-actions"><button className="primary-button" onClick={() => setModal(null)}>Done</button></div>}</>
            ) : selectedCardType ? (
              <><p className="eyebrow">Card metadata</p><h2 id="modal-title">Edit {selectedCardType.name}</h2><p>Update the definition or add another recurring benefit.</p><form onSubmit={submitCardTypeEdit}><label><span>Card name</span><input name="name" required defaultValue={selectedCardType.name} /></label><div className="form-grid"><label><span>Issuer</span><input name="issuer" required defaultValue={selectedCardType.issuer} /></label><label><span>Card kind</span><select name="kind" defaultValue={selectedCardType.kind}><option value="personal">Personal</option><option value="business">Business</option><option value="other">Other</option></select></label><label><span>Annual fee</span><input name="annualFee" type="number" min="0" defaultValue={selectedCardType.annualFee} /></label><label><span>New benefit frequency</span><select name="benefitFrequency" defaultValue="calendar year"><option>calendar year</option><option>anniversary</option><option>biannual</option><option>quarter</option><option>monthly</option></select></label></div><div className="form-grid"><label><span>Add benefit (optional)</span><input name="benefitName" placeholder="e.g. Hotel credit" /></label><label><span>Benefit amount</span><input name="benefitAmount" type="number" min="0" defaultValue="0" /></label></div><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save definition"}</button></div></form></>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
