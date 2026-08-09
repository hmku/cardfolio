"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { annualFeePayments, bonusDeadline, cardAction, creditPeriod, dateAtNoon, daysUntilDate, fiveTwentyFourAccounts, isSecondaryCredit, type ActionRule } from "../lib/portfolio";

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
  actionRules: ActionRule[];
  members: { user_id: string; email: string; role: "owner" | "member"; created_at: string }[];
  invitations: { id: string; email: string; role: "owner" | "member"; accepted_at: string | null; created_at: string }[];
  currentUser: { email: string; role: "owner" | "member" };
  source: { spreadsheetId: string; migratedAt: string };
};

type View = "overview" | "cards" | "types" | "credits" | "rules";
type Modal = "account" | "editAccount" | "cardType" | "editCardType" | "closeAccount" | "rule" | "access" | null;
type CardSortKey = "card" | "type" | "status" | "approved" | "bonus" | "annualFees" | "nextAction";
type SortDirection = "ascending" | "descending";
type UndoNotice = {
  message: string;
  payload: Record<string, unknown>;
};

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

function ruleDescription(rule: ActionRule) {
  const condition = rule.conditions;
  const parts: string[] = [];
  if (condition.cardNames?.length) parts.push(condition.cardNames.join(" or "));
  if (condition.requiresOpen) parts.push("card is open");
  if (condition.approvalAgeMin !== undefined || condition.approvalAgeMax !== undefined) parts.push(`approval age ${condition.approvalAgeMin ?? 0}–${condition.approvalAgeMax ?? "∞"} days`);
  if (condition.closureAgeMin !== undefined || condition.closureAgeMax !== undefined) parts.push(`closure age ${condition.closureAgeMin ?? 0}–${condition.closureAgeMax ?? "∞"} days`);
  if (condition.annualFeeMin !== undefined) parts.push(`annual fee at least ${money.format(condition.annualFeeMin)}`);
  if (condition.anniversaryBeforeDays !== undefined || condition.anniversaryAfterDays !== undefined) parts.push(`${condition.anniversaryBeforeDays ?? 0} days before to ${condition.anniversaryAfterDays ?? 0} days after anniversary`);
  if (condition.latestCardOnly) parts.push("highest card index only");
  return parts.length ? parts.join(" · ") : "Every card";
}

function RuleAction({ actionCode }: { actionCode: string }) {
  const closesCard = actionCode.trim().toUpperCase() === "CLOSE";
  return (
    <span className={`rule-action ${closesCard ? "close" : "follow-up"}`}>
      <span className="rule-action-icon" aria-hidden="true">
        {closesCard ? (
          <svg viewBox="0 0 20 20" role="img"><path d="m6 6 8 8M14 6l-8 8" /></svg>
        ) : (
          <svg viewBox="0 0 20 20" role="img"><path d="M4.5 10h10M11 6.5l3.5 3.5-3.5 3.5" /></svg>
        )}
      </span>
      <span className="rule-action-copy"><small>Action</small><strong>{actionCode}</strong></span>
    </span>
  );
}

function accountEditPayload(account: Account) {
  return {
    action: "updateAccount",
    accountId: account.id,
    owner: account.owner,
    cardTypeId: account.cardTypeId,
    kind: account.kind,
    cardIndex: account.cardIndex || "",
    appliedOn: account.appliedOn || "",
    approvedOn: account.approvedOn || "",
    openedHow: account.openedHow || "",
    offer: account.offer || "",
    bonusAmount: account.bonusAmount || "",
    spendRequirement: account.spendRequirement ?? "",
    bonusPeriodMonths: account.bonusPeriodMonths ?? "",
    annualFee: account.annualFee,
    bonusReceived: Boolean(account.bonusReceived),
    status: account.status,
    closedOn: account.closedOn || "",
    closedHow: account.closedHow || "",
  };
}

export function TrackerApp({ accessToken, userEmail, onSignOut }: { accessToken: string; userEmail: string; onSignOut: () => Promise<void> }) {
  const [referenceTime] = useState(() => Date.now());
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("overview");
  const [owner, setOwner] = useState("All");
  const [status, setStatus] = useState("all");
  const [cardSort, setCardSort] = useState<{ key: CardSortKey; direction: SortDirection }>({ key: "approved", direction: "descending" });
  const [search, setSearch] = useState("");
  const [typeSearch, setTypeSearch] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [selectedCardType, setSelectedCardType] = useState<CardType | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [selectedRule, setSelectedRule] = useState<ActionRule | null>(null);
  const [undoNotice, setUndoNotice] = useState<UndoNotice | null>(null);
  const [saving, setSaving] = useState(false);
  const [expandedBenefit, setExpandedBenefit] = useState<number | null>(null);
  const [visibleCards, setVisibleCards] = useState(20);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/data", { headers: { authorization: `Bearer ${accessToken}` } })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load your tracker");
        setData(payload);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load your tracker"));
  }, [accessToken]);

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

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

  const actionQueue = ownerAccounts
    .map((account) => ({ account, action: cardAction(account, data?.accounts ?? [], referenceDate, data?.actionRules ?? []) }))
    .filter((item): item is { account: Account; action: NonNullable<ReturnType<typeof cardAction>> } => Boolean(item.action))
    .sort((a, b) => a.action.localeCompare(b.action) || a.account.cardName.localeCompare(b.account.cardName));

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

  const priorityBenefitSummaries = benefitSummaries.filter((summary) => !isSecondaryCredit(summary.benefit.name));
  const secondaryBenefitSummaries = benefitSummaries.filter((summary) => isSecondaryCredit(summary.benefit.name));

  const selectedAccountCredits = selectedAccount && data ? data.benefits
    .filter((benefit) => benefit.cardTypeId === selectedAccount.cardTypeId)
    .map((benefit) => {
      const period = creditPeriod(benefit.frequency, selectedAccount.approvedOn, referenceDate);
      const compatibilityKeys = new Set([period.key]);
      if (benefit.frequency.toLowerCase().includes("anniversary")) compatibilityKeys.add(`${referenceDate.getFullYear()}-anniversary`);
      const usage = data.usages.find((row) => row.benefitId === benefit.id && row.accountId === selectedAccount.id && compatibilityKeys.has(row.periodKey));
      return { benefit, period, periodKey: period.key, used: Boolean(usage?.used) };
    })
    .sort((left, right) => Number(isSecondaryCredit(left.benefit.name)) - Number(isSecondaryCredit(right.benefit.name)) || left.period.end.getTime() - right.period.end.getTime()) : [];

  const urgentCreditInstances = priorityBenefitSummaries
    .flatMap((summary) => summary.accounts.map((row) => ({ ...row, benefit: summary.benefit })))
    .filter((item) => !item.used)
    .sort((a, b) => a.period.end.getTime() - b.period.end.getTime());

  const creditsUsed = benefitSummaries.reduce((total, summary) => total + summary.used, 0);
  const creditsTotal = benefitSummaries.reduce((total, summary) => total + summary.total, 0);

  function dismissUndo() {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setUndoNotice(null);
  }

  function offerUndo(message: string, payload: Record<string, unknown>) {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoNotice({ message, payload });
    undoTimer.current = setTimeout(() => {
      setUndoNotice(null);
      undoTimer.current = null;
    }, 8_000);
  }

  async function post(payload: Record<string, unknown>, undo?: UndoNotice) {
    if (!undo) dismissUndo();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/data", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` }, body: JSON.stringify(payload) });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "Unable to save changes");
      setData(next);
      if (undo) offerUndo(undo.message, undo.payload);
      return next as AppData;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save changes");
      return null;
    } finally {
      setSaving(false);
    }
  }

  function renderBenefitSummary(summary: (typeof benefitSummaries)[number]) {
    const percent = summary.total ? Math.round(summary.used / summary.total * 100) : 0;
    const expanded = expandedBenefit === summary.benefit.id;
    const firstPeriod = summary.accounts[0]?.period;
    return <article className={`benefit-card ${expanded ? "expanded" : ""}`} key={summary.benefit.id}><button className="benefit-summary" onClick={() => setExpandedBenefit(expanded ? null : summary.benefit.id)} aria-expanded={expanded}><span className="benefit-symbol">{initials(summary.benefit.cardName)}</span><span className="benefit-title"><small>{summary.benefit.cardName}</small><strong>{summary.benefit.name}</strong><em>{summary.benefit.frequency}{firstPeriod ? ` · ${formatDate(firstPeriod.start.toISOString().slice(0, 10))}–${formatDate(firstPeriod.end.toISOString().slice(0, 10))}` : ""}</em></span><span className="benefit-value">{money.format(summary.benefit.amount)}<small>per card</small></span><span className="benefit-progress"><b>{summary.used}/{summary.total}</b><span className="progress-track"><i style={{ width: `${percent}%` }} /></span><small>{summary.total - summary.used} remaining · due {formatDate(summary.nextDue.toISOString().slice(0, 10))}</small></span><span className="expand-icon">⌄</span></button>{expanded && <div className="benefit-accounts"><div className="benefit-explainer"><strong>Usage by card</strong><span>Sorted by the deadline for each account’s current period.</span></div>{summary.accounts.map(({ account, period, periodKey, used }) => <button key={account.id} className={`usage-row ${used ? "used" : ""}`} disabled={saving} onClick={() => post({ action: "toggleUsage", accountId: account.id, benefitId: summary.benefit.id, periodKey, used: !used }, { message: `${summary.benefit.name} marked ${used ? "unused" : "used"} for ${account.cardName}.`, payload: { action: "toggleUsage", accountId: account.id, benefitId: summary.benefit.id, periodKey, used } })}><span className="usage-check">{used ? "✓" : ""}</span><span><strong>{account.owner} · {account.cardName}{account.cardIndex ? ` ${account.cardIndex}` : ""}</strong><small>Available {formatDate(period.start.toISOString().slice(0, 10))} · use by {formatDate(period.end.toISOString().slice(0, 10))}</small></span><em>{used ? "Used" : `${daysUntilDate(period.end, referenceDate)}d left`}</em></button>)}</div>}</article>;
  }

  async function undoLastAction() {
    if (!undoNotice) return;
    const payload = undoNotice.payload;
    dismissUndo();
    await post(payload);
  }

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const cardType = data?.cardTypes.find((item) => item.id === Number(values.cardTypeId));
    const saved = await post({ action: "createAccount", ...values, annualFee: cardType?.annualFee || 0, kind: cardType?.kind || "personal" });
    if (saved) setModal(null);
  }

  async function submitAccountEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccount) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const saved = await post(
      {
        action: "updateAccount",
        accountId: selectedAccount.id,
        ...values,
        bonusReceived: values.bonusReceived === "on",
      },
      {
        message: `${selectedAccount.cardName} was updated.`,
        payload: accountEditPayload(selectedAccount),
      },
    );
    if (saved) {
      setModal(null);
      setSelectedAccount(null);
    }
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

  function openRule(rule: ActionRule | null) {
    setSelectedRule(rule);
    setModal("rule");
  }

  async function submitActionRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const conditions = {
      cardNames: form.getAll("cardNames"),
      requiresOpen: form.get("requiresOpen") === "on",
      approvalAgeMin: form.get("approvalAgeMin"),
      approvalAgeMax: form.get("approvalAgeMax"),
      closureAgeMin: form.get("closureAgeMin"),
      closureAgeMax: form.get("closureAgeMax"),
      annualFeeMin: form.get("annualFeeMin"),
      anniversaryBeforeDays: form.get("anniversaryBeforeDays"),
      anniversaryAfterDays: form.get("anniversaryAfterDays"),
      latestCardOnly: form.get("latestCardOnly") === "on",
    };
    const saved = await post({
      action: selectedRule ? "updateActionRule" : "createActionRule",
      ruleId: selectedRule?.id,
      name: form.get("name"),
      actionCode: form.get("actionCode"),
      priority: form.get("priority"),
      enabled: form.get("enabled") === "on",
      conditions,
    });
    if (saved) {
      setModal(null);
      setSelectedRule(null);
    }
  }

  async function deleteActionRule(rule: ActionRule) {
    if (!window.confirm(`Delete “${rule.name}”?`)) return;
    const saved = await post({ action: "deleteActionRule", ruleId: rule.id });
    if (saved) {
      setModal(null);
      setSelectedRule(null);
    }
  }

  function openCloseAccount(account: Account) {
    setSelectedAccount(account);
    setModal("closeAccount");
  }

  function openAccountDetails(account: Account) {
    setSelectedAccount(account);
    setModal("editAccount");
  }

  async function setBonusReceived(account: Account, received: boolean) {
    await post(
      { action: "toggleBonus", accountId: account.id, received },
      {
        message: `${account.cardName} bonus marked ${received ? "received" : "not received"}.`,
        payload: { action: "toggleBonus", accountId: account.id, received: !received },
      },
    );
  }

  async function submitCloseAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccount) return;
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const saved = await post(
      { action: "closeAccount", accountId: selectedAccount.id, ...values },
      {
        message: `${selectedAccount.cardName} was closed.`,
        payload: { action: "reopenAccount", accountId: selectedAccount.id },
      },
    );
    if (saved) {
      setModal(null);
      setSelectedAccount(null);
    }
  }

  async function reopenAccount(account: Account) {
    await post(
      { action: "reopenAccount", accountId: account.id },
      {
        message: `${account.cardName} was reopened.`,
        payload: {
          action: "closeAccount",
          accountId: account.id,
          closedOn: account.closedOn || new Date().toISOString().slice(0, 10),
          closedHow: account.closedHow || "Closed",
        },
      },
    );
  }

  const filteredCards = ownerAccounts.filter((account) => {
    const matchesStatus = status === "all" || account.status === status;
    const haystack = `${account.cardName} ${account.issuer} ${account.bonusAmount || ""} ${account.offer || ""}`.toLowerCase();
    return matchesStatus && haystack.includes(search.toLowerCase());
  });
  const sortedCards = [...filteredCards].sort((left, right) => {
    const sortValue = (account: Account) => {
      if (cardSort.key === "card") return `${account.cardName} ${account.cardIndex || ""}`.toLowerCase();
      if (cardSort.key === "type") return `${account.kind} ${account.issuer}`.toLowerCase();
      if (cardSort.key === "status") return account.status;
      if (cardSort.key === "approved") return account.approvedOn || account.appliedOn || "";
      if (cardSort.key === "bonus") return `${account.bonusAmount || ""} ${account.spendRequirement ?? ""}`.toLowerCase();
      if (cardSort.key === "annualFees") return account.annualFee;
      return cardAction(account, data?.accounts ?? [], referenceDate, data?.actionRules ?? []) || "";
    };
    const leftValue = sortValue(left);
    const rightValue = sortValue(right);
    const comparison = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), undefined, { numeric: true });
    return cardSort.direction === "ascending" ? comparison : -comparison;
  });

  function changeCardSort(key: CardSortKey) {
    setCardSort((current) => ({
      key,
      direction: current.key === key && current.direction === "ascending" ? "descending" : "ascending",
    }));
  }

  function cardSortHeader(key: CardSortKey, label: string) {
    const active = cardSort.key === key;
    return (
      <th aria-sort={active ? cardSort.direction : "none"}>
        <button className={active ? "sort-button active" : "sort-button"} onClick={() => changeCardSort(key)}>
          {label}<span aria-hidden="true">{active ? (cardSort.direction === "ascending" ? "↑" : "↓") : "↕"}</span>
        </button>
      </th>
    );
  }
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
    return <main className="loading-screen"><div className="error-card"><strong>We couldn’t open Cardfolio.</strong><span>{error}</span><button className="primary-button" onClick={() => location.reload()}>Try again</button></div></main>;
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
          <button className={view === "rules" ? "active" : ""} onClick={() => setView("rules")}><span>⚙</span>Rules</button>
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
        {undoNotice && <div className="undo-toast" role="status" aria-live="polite"><span>{undoNotice.message}</span><button onClick={() => void undoLastAction()} disabled={saving}>{saving ? "Undoing…" : "Undo"}</button><button className="undo-dismiss" onClick={dismissUndo} aria-label="Dismiss undo">×</button></div>}

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
                <div className="panel-heading"><div><p className="eyebrow">Needs attention</p><h2>Action queue</h2></div><button className="text-button" onClick={() => { setStatus("all"); setView("cards"); }}>View cards →</button></div>
                <div className="review-list">
                  {actionQueue.slice(0, 5).map(({ account, action }) => <div className="review-row" key={account.id}><span className={`issuer-badge ${account.issuer.replace(/\s/g, "").toLowerCase()}`}>{initials(account.issuer)}</span><button className="review-card-name card-link" onClick={() => openAccountDetails(account)}><strong>{account.cardName}{account.cardIndex ? ` ·${account.cardIndex}` : ""}</strong><span>{account.owner} · {account.openedHow || "Opening method not recorded"}</span></button><span className="action-code">{action}</span>{action === "CLOSE" ? <button className="row-action" onClick={() => openCloseAccount(account)} disabled={saving}>Close</button> : <button className="row-action" onClick={() => openAccountDetails(account)} disabled={saving}>Review</button>}</div>)}
                  {actionQueue.length === 0 && <div className="empty-state">No cards currently match the spreadsheet action rules.</div>}
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
                  return <div className="bonus-row" key={account.id}><span className={`owner-badge ${account.owner.toLowerCase()}`}>{initials(account.owner)}</span><button className="bonus-card card-link" onClick={() => openAccountDetails(account)}><strong>{account.cardName}{account.cardIndex ? ` ·${account.cardIndex}` : ""}</strong><small>{account.owner} · approved {formatDate(account.approvedOn)}</small></button><span className="bonus-term"><small>Bonus</small><strong>{formatBonusAmount(account.bonusAmount)}</strong></span><span className="bonus-term"><small>Spend</small><strong>{account.spendRequirement === null ? "—" : money.format(account.spendRequirement)}</strong></span><span className={`date-pill ${days <= 30 ? "urgent" : ""}`}><strong>{days < 0 ? `${Math.abs(days)}d past` : `${days}d left`}</strong><span>Due {formatDate(deadline.toISOString().slice(0, 10))}</span></span><button className="row-action" onClick={() => setBonusReceived(account, true)} disabled={saving}>Mark hit</button></div>;
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
            <div className="cards-table-wrap"><table className="cards-table"><thead><tr>{cardSortHeader("card", "Card")}{cardSortHeader("type", "Type")}{cardSortHeader("status", "Status")}{cardSortHeader("approved", "Approved")}{cardSortHeader("bonus", "Signup bonus")}{cardSortHeader("annualFees", "Annual fees")}{cardSortHeader("nextAction", "Next action")}<th>Actions</th></tr></thead><tbody>{sortedCards.slice(0, visibleCards).map((account) => { const action = cardAction(account, data.accounts, referenceDate, data.actionRules); const paid = annualFeePayments(account, referenceDate); return <tr key={account.id}><td><button className="table-card card-link" onClick={() => openAccountDetails(account)}><span className={`owner-badge ${account.owner.toLowerCase()}`}>{initials(account.owner)}</span><span><strong>{account.cardName}{account.cardIndex ? ` ·${account.cardIndex}` : ""}</strong><small>{account.issuer} · {account.owner}</small></span></button></td><td><span className={`kind-pill ${account.kind.toLowerCase()}`}>{account.kind}</span></td><td><span className={`status-pill ${account.status}`}>{account.status}</span></td><td>{formatDate(account.approvedOn || account.appliedOn)}</td><td className="offer-cell">{account.bonusAmount ? <span className="structured-offer"><strong>{formatBonusAmount(account.bonusAmount)}</strong><small>{account.spendRequirement === null ? "No spend recorded" : `${money.format(account.spendRequirement)} spend`} · {account.bonusPeriodMonths || 3} months</small></span> : "—"}</td><td><span className="fee-history"><strong>{money.format(account.annualFee)}</strong><small>{paid.count ? `${paid.count} paid · ${money.format(paid.total)} total` : "No annual fee"}</small></span></td><td>{action ? <span className="action-code">{action}</span> : "—"}</td><td><span className="row-actions"><button className="kebab" onClick={() => openAccountDetails(account)} disabled={saving}>Edit</button>{account.status === "active" && <button className="kebab" onClick={() => openCloseAccount(account)} title="Mark this card closed" disabled={saving}>Close</button>}{account.status === "closed" && <button className="kebab" onClick={() => reopenAccount(account)} title="Reopen this card" disabled={saving}>Reopen</button>}</span></td></tr>; })}</tbody></table>{filteredCards.length === 0 && <div className="empty-state">No cards match these filters.</div>}</div>
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
                <section className="credit-section"><div className="credit-section-heading"><span><p className="eyebrow">Priority</p><h2>Important credits</h2></span><em>{priorityBenefitSummaries.length}</em></div>{priorityBenefitSummaries.map(renderBenefitSummary)}{priorityBenefitSummaries.length === 0 && <div className="empty-state">No priority credits are active.</div>}</section>
                <section className="credit-section secondary"><div className="credit-section-heading"><span><p className="eyebrow">Lower priority</p><h2>Clear, office supply, and wireless</h2></span><em>{secondaryBenefitSummaries.length}</em></div>{secondaryBenefitSummaries.map(renderBenefitSummary)}{secondaryBenefitSummaries.length === 0 && <div className="empty-state">No lower-priority credits are active.</div>}</section>
              </div>
              <aside className="credits-aside"><p className="eyebrow">Current period</p><h2>{creditsUsed} of {creditsTotal} credits logged</h2><div className="donut" style={{ "--progress": `${creditsTotal ? creditsUsed / creditsTotal * 360 : 0}deg` } as React.CSSProperties}><span><strong>{creditsTotal ? Math.round(creditsUsed / creditsTotal * 100) : 0}%</strong><small>complete</small></span></div><p>Credits are ordered by their inferred expiration dates. Monthly, quarterly, half-year, calendar-year, and anniversary periods reset automatically.</p><div className="aside-rule" /><span className="aside-kicker">Most urgent</span>{urgentCreditInstances.slice(0, 4).map((item) => <button key={`${item.benefit.id}-${item.account.id}`} onClick={() => setExpandedBenefit(item.benefit.id)}><span>{initials(item.benefit.cardName)}</span><strong>{item.account.owner} · {item.benefit.name}</strong><em>{daysUntilDate(item.period.end, referenceDate)}d</em></button>)}</aside>
            </div>
          </section>
        )}

        {view === "rules" && (
          <section className="page">
            <div className="section-heading"><div><p className="eyebrow">Dynamic automation</p><h1>Action rules</h1><p>The first enabled rule that matches a card determines its Next action.</p></div><button className="primary-button" onClick={() => openRule(null)}>＋ New rule</button></div>
            <div className="rules-help"><strong>How precedence works</strong><span>Rules run from the lowest priority number to the highest. Drag-free ordering stays predictable: edit a priority to move a rule earlier or later.</span></div>
            <div className="rule-list">
              {data.actionRules.map((rule) => <article className={rule.enabled ? "rule-card" : "rule-card disabled"} key={rule.id}><span className="rule-priority"><small>Priority</small><strong>{rule.priority}</strong></span><RuleAction actionCode={rule.actionCode} /><span className="rule-copy"><strong>{rule.name}</strong><small>{ruleDescription(rule)}</small></span><span className={rule.enabled ? "rule-state enabled" : "rule-state"}>{rule.enabled ? "Enabled" : "Disabled"}</span><button className="secondary-button" onClick={() => openRule(rule)}>Edit</button></article>)}
              {data.actionRules.length === 0 && <div className="empty-state">No action rules exist yet. Add one to begin calculating Next action.</div>}
            </div>
          </section>
        )}
      </main>

      {modal && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
          <section className={modal === "editAccount" ? "modal account-modal" : "modal"} role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <button className="modal-close" onClick={() => setModal(null)} aria-label="Close">×</button>
            {modal === "account" ? (
              <><p className="eyebrow">Portfolio entry</p><h2 id="modal-title">Add a card</h2><p>Record a new application or an approved card.</p><form onSubmit={submitAccount}><label><span>Card type</span><select name="cardTypeId" required defaultValue=""><option value="" disabled>Select a card</option>{data.cardTypes.map((card) => <option key={card.id} value={card.id}>{card.name} · {card.issuer}</option>)}</select></label><div className="form-grid"><label><span>Owner</span><select name="owner" defaultValue={owner === "All" ? "Harrison" : owner}>{owners.map((name) => <option key={name}>{name}</option>)}</select></label><label><span>Opened via</span><select name="openedHow" defaultValue="applied"><option>applied</option><option>referred</option><option>nll</option><option>downgraded</option><option>upgraded</option></select></label><label><span>Applied</span><input type="date" name="appliedOn" defaultValue={new Date().toISOString().slice(0, 10)} /></label><label><span>Approved</span><input type="date" name="approvedOn" /></label></div><div className="form-grid bonus-fields"><label><span>Bonus amount</span><input name="bonusAmount" placeholder="e.g. 100k points" /></label><label><span>Required spend ($)</span><input name="spendRequirement" type="number" min="0" placeholder="5000" /></label><label><span>Qualification period</span><select name="bonusPeriodMonths" defaultValue="3"><option value="3">3 months</option><option value="4">4 months</option><option value="6">6 months</option><option value="9">9 months</option><option value="12">12 months</option></select></label></div><p className="form-help">If no period is specified, Cardfolio uses three months.</p><label className="check-label"><input type="checkbox" name="bonusReceived" /><span>Signup bonus received</span></label><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Add card"}</button></div></form></>
            ) : modal === "editAccount" && selectedAccount ? (
              <>
                <p className="eyebrow">Card record</p>
                <h2 id="modal-title">Edit {selectedAccount.cardName}</h2>
                <p>Review account details and track the credits available on this specific card.</p>
                <form onSubmit={submitAccountEdit}>
                  <label><span>Card type</span><select name="cardTypeId" required defaultValue={selectedAccount.cardTypeId}>{data.cardTypes.map((card) => <option key={card.id} value={card.id}>{card.name} · {card.issuer}</option>)}</select></label>
                  <div className="form-grid"><label><span>Owner</span><input name="owner" list="card-owners" required defaultValue={selectedAccount.owner} /><datalist id="card-owners">{owners.map((name) => <option key={name} value={name} />)}</datalist></label><label><span>Card kind</span><select name="kind" defaultValue={selectedAccount.kind}><option value="personal">Personal</option><option value="business">Business</option><option value="other">Other</option></select></label><label><span>Card index</span><input name="cardIndex" defaultValue={selectedAccount.cardIndex || ""} placeholder="e.g. hk2" /></label><label><span>Status</span><select name="status" defaultValue={selectedAccount.status}><option value="active">Active</option><option value="closed">Closed</option><option value="pending">Pending</option><option value="declined">Declined</option></select></label><label><span>Applied</span><input type="date" name="appliedOn" defaultValue={selectedAccount.appliedOn || ""} /></label><label><span>Approved</span><input type="date" name="approvedOn" defaultValue={selectedAccount.approvedOn || ""} /></label><label><span>Opened via</span><input name="openedHow" defaultValue={selectedAccount.openedHow || ""} placeholder="applied, downgraded, upgraded…" /></label><label><span>Annual fee</span><input name="annualFee" type="number" min="0" defaultValue={selectedAccount.annualFee} /></label></div>
                  <label><span>Original offer note</span><input name="offer" defaultValue={selectedAccount.offer || ""} placeholder="Any free-form signup offer details" /></label>
                  <div className="form-grid bonus-fields"><label><span>Bonus amount</span><input name="bonusAmount" defaultValue={selectedAccount.bonusAmount || ""} placeholder="e.g. 100k points" /></label><label><span>Required spend ($)</span><input name="spendRequirement" type="number" min="0" defaultValue={selectedAccount.spendRequirement ?? ""} /></label><label><span>Qualification period (months)</span><input name="bonusPeriodMonths" type="number" min="1" defaultValue={selectedAccount.bonusPeriodMonths ?? ""} /></label></div>
                  <label className="check-label"><input type="checkbox" name="bonusReceived" defaultChecked={Boolean(selectedAccount.bonusReceived)} /><span>Signup bonus received</span></label>
                  <div className="form-grid"><label><span>Closed or decided on</span><input type="date" name="closedOn" defaultValue={selectedAccount.closedOn || ""} /></label><label><span>Closure or decision details</span><input name="closedHow" defaultValue={selectedAccount.closedHow || ""} placeholder="e.g. Downgraded to Freedom Flex" /></label></div>
                  <p className="form-help">Set Status to Declined to record an unsuccessful application. Set it to Active to reopen a card.</p>
                  <section className="account-credits embedded">
                    <div className="account-credits-heading"><span><p className="eyebrow">Card benefits</p><h3>Credits this period</h3><small>Usage is tracked separately for this exact card.</small></span><em>{selectedAccountCredits.filter((item) => item.used).length} of {selectedAccountCredits.length} used</em></div>
                    {selectedAccountCredits.length ? <div className="account-credit-list">{selectedAccountCredits.map(({ benefit, period, periodKey, used }) => <button type="button" key={benefit.id} className={`account-credit ${used ? "used" : ""}`} disabled={saving} onClick={() => post({ action: "toggleUsage", accountId: selectedAccount.id, benefitId: benefit.id, periodKey, used: !used }, { message: `${benefit.name} marked ${used ? "unused" : "used"} for ${selectedAccount.cardName}.`, payload: { action: "toggleUsage", accountId: selectedAccount.id, benefitId: benefit.id, periodKey, used } })}><span className="usage-check">{used ? "✓" : ""}</span><span className="account-credit-copy"><strong>{benefit.name}</strong><small>{money.format(benefit.amount)} · {benefit.frequency}{isSecondaryCredit(benefit.name) ? " · lower priority" : ""}</small></span><span className="account-credit-due"><strong>{used ? "Used" : `${daysUntilDate(period.end, referenceDate)}d left`}</strong><small>Due {formatDate(period.end.toISOString().slice(0, 10))}</small></span></button>)}</div> : <div className="empty-state compact">This card type has no recurring credits.</div>}
                  </section>
                  <div className="form-actions"><button type="button" className="secondary-button" onClick={() => { setModal(null); setSelectedAccount(null); }}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Save card"}</button></div>
                </form>
              </>
            ) : modal === "closeAccount" && selectedAccount ? (
              <><p className="eyebrow">Account history</p><h2 id="modal-title">Close {selectedAccount.cardName}</h2><p>Record what happened so the ledger reflects a closure, downgrade, upgrade, or product change.</p><form onSubmit={submitCloseAccount}><label><span>How was this card closed?</span><input name="closedHow" list="closure-options" required autoFocus placeholder="e.g. Downgraded to Freedom Flex" /><datalist id="closure-options"><option value="Closed" /><option value="Downgraded" /><option value="Upgraded" /><option value="Product changed" /></datalist></label><label><span>Date</span><input type="date" name="closedOn" required defaultValue={new Date().toISOString().slice(0, 10)} /></label><p className="form-help">You can enter any description. The complete text will appear in the Cards ledger.</p><div className="form-actions"><button type="button" className="secondary-button" onClick={() => { setModal(null); setSelectedAccount(null); }}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Close card"}</button></div></form></>
            ) : modal === "cardType" ? (
              <><p className="eyebrow">Reusable definition</p><h2 id="modal-title">New card type</h2><p>Define the card once, then attach future applications and benefits to it.</p><form onSubmit={submitCardType}><label><span>Card name</span><input name="name" required placeholder="e.g. Sapphire Preferred" /></label><div className="form-grid"><label><span>Issuer</span><input name="issuer" required placeholder="e.g. Chase" /></label><label><span>Card kind</span><select name="kind" defaultValue="personal"><option value="personal">Personal</option><option value="business">Business</option><option value="other">Other</option></select></label><label><span>Annual fee</span><input name="annualFee" type="number" min="0" defaultValue="0" /></label><label><span>Benefit frequency</span><select name="benefitFrequency" defaultValue="calendar year"><option>calendar year</option><option>anniversary</option><option>biannual</option><option>quarter</option><option>monthly</option></select></label></div><div className="form-grid"><label><span>First benefit (optional)</span><input name="benefitName" placeholder="e.g. Hotel credit" /></label><label><span>Benefit amount</span><input name="benefitAmount" type="number" min="0" defaultValue="0" /></label></div><div className="form-actions"><button type="button" className="secondary-button" onClick={() => setModal(null)}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : "Create card type"}</button></div></form></>
            ) : modal === "rule" ? (
              <><p className="eyebrow">Dynamic action</p><h2 id="modal-title">{selectedRule ? `Edit ${selectedRule.name}` : "New action rule"}</h2><p>All filled conditions must match. Leave a numeric field blank when that condition should not apply.</p><form onSubmit={submitActionRule}><div className="form-grid"><label><span>Rule name</span><input name="name" required defaultValue={selectedRule?.name || ""} placeholder="e.g. Review Sapphire renewal" /></label><label><span>Action label</span><input name="actionCode" required defaultValue={selectedRule?.actionCode || ""} placeholder="e.g. REVIEW" /></label><label><span>Priority</span><input name="priority" type="number" min="0" required defaultValue={selectedRule?.priority ?? (data.actionRules.length + 1) * 10} /></label><label className="check-label rule-toggle"><input type="checkbox" name="enabled" defaultChecked={selectedRule?.enabled ?? true} /><span>Rule enabled</span></label></div><label><span>Limit to card types (leave unselected for every card)</span><select name="cardNames" multiple size={Math.min(7, Math.max(4, data.cardTypes.length))} defaultValue={selectedRule?.conditions.cardNames || []}>{data.cardTypes.map((card) => <option key={card.id} value={card.name}>{card.name} · {card.issuer}</option>)}</select></label><div className="form-grid rule-number-grid"><label><span>Approval age — minimum days</span><input name="approvalAgeMin" type="number" min="0" defaultValue={selectedRule?.conditions.approvalAgeMin ?? ""} /></label><label><span>Approval age — maximum days</span><input name="approvalAgeMax" type="number" min="0" defaultValue={selectedRule?.conditions.approvalAgeMax ?? ""} /></label><label><span>Closure age — minimum days</span><input name="closureAgeMin" type="number" min="0" defaultValue={selectedRule?.conditions.closureAgeMin ?? ""} /></label><label><span>Closure age — maximum days</span><input name="closureAgeMax" type="number" min="0" defaultValue={selectedRule?.conditions.closureAgeMax ?? ""} /></label><label><span>Minimum annual fee ($)</span><input name="annualFeeMin" type="number" min="0" defaultValue={selectedRule?.conditions.annualFeeMin ?? ""} /></label><span className="rule-grid-spacer" /><label><span>Days before anniversary</span><input name="anniversaryBeforeDays" type="number" min="0" max="364" defaultValue={selectedRule?.conditions.anniversaryBeforeDays ?? ""} /></label><label><span>Days after anniversary</span><input name="anniversaryAfterDays" type="number" min="0" max="364" defaultValue={selectedRule?.conditions.anniversaryAfterDays ?? ""} /></label></div><div className="rule-checks"><label className="check-label"><input type="checkbox" name="requiresOpen" defaultChecked={selectedRule?.conditions.requiresOpen || false} /><span>Only match cards that are still open</span></label><label className="check-label"><input type="checkbox" name="latestCardOnly" defaultChecked={selectedRule?.conditions.latestCardOnly || false} /><span>Only match the highest card index for that card type</span></label></div><div className="form-actions rule-form-actions">{selectedRule && <button type="button" className="danger-button" onClick={() => void deleteActionRule(selectedRule)} disabled={saving}>Delete rule</button>}<span /><button type="button" className="secondary-button" onClick={() => { setModal(null); setSelectedRule(null); }}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? "Saving…" : selectedRule ? "Save rule" : "Create rule"}</button></div></form></>
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
