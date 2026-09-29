"use client";

import { useState, type ReactNode } from "react";
import { anniversaryIn, daysBetween, parseDate } from "../lib/core/dates";
import { bonusLabel, holdingName, type Account, type Holding, type Portfolio } from "../lib/core/model";
import { accountAction } from "../lib/core/rules";
import { bonusStatus, feeStatus } from "../lib/core/stats";
import { Dot, inDays, money, monthYear, personTone, shortDate, Tag } from "./ui";

const VIA_LABELS: Record<Account["openedVia"], string> = { applied: "Applied", referral: "Referral", nll_offer: "NLL offer", product_change: "Product change", other: "Other" };
const FEE_WINDOW_DAYS = 45;
const RECENT_CHANGE_DAYS = 120;

type Tone = "alert" | "due" | "info" | "kept";
type Props = { portfolio: Portfolio; accounts: Account[]; today: Date; onOpenAccount: (id: number) => void };

/** "$695 fee posted Sep 13" when this year's fee has already hit, else "$95 fee tomorrow". */
function feeTiming(account: Account, fee: { next: Date; daysLeft: number; feeCents: number }, today: Date) {
  const approved = parseDate(account.approvedOn);
  const last = approved ? anniversaryIn(approved, today.getFullYear()) : null;
  if (last && last.getTime() <= today.getTime() && fee.daysLeft > 180) return `${money(fee.feeCents)} fee posted ${shortDate(last)}`;
  return `${money(fee.feeCents)} fee ${inDays(fee.daysLeft)}`;
}

/** Open over a year (so the first fee has posted) and not in a review window right now. */
function keptPastFirstFee(account: Account, today: Date) {
  const approved = parseDate(account.approvedOn);
  return account.status === "open" && Boolean(approved) && daysBetween(approved!, today) >= 365;
}

/**
 * What a card needs, as tags plus the row's shade: red when there's a decision to make
 * (keep or close, a missed bonus), amber while a bonus is still being worked on, blue while
 * an application is pending, and a light violet for cards kept past their first annual fee
 * (worth a second look now and then). Everything else is plain.
 */
function cardStatus(portfolio: Portfolio, account: Account, holding: Holding, today: Date) {
  const tags: ReactNode[] = [];
  const tones: Tone[] = [];
  let kept = false;

  const rule = accountAction(portfolio, account, today);
  const fee = feeStatus(portfolio, account, today);
  if (rule) {
    tones.push("alert");
    tags.push(<Tag key="rule" tone="alert" title={rule.name}>
      {rule.actionCode === "CLOSE" && fee ? `Keep or close? ${feeTiming(account, fee, today)}` : rule.name}
    </Tag>);
  } else if (fee && keptPastFirstFee(account, today)) {
    kept = true;
    tags.push(<Tag key="kept" tone="kept" title="Open more than a year with an annual fee">
      Kept · {money(fee.feeCents)} fee {fee.daysLeft <= FEE_WINDOW_DAYS ? inDays(fee.daysLeft) : monthYear(fee.next)}
    </Tag>);
  } else if (fee && fee.daysLeft <= FEE_WINDOW_DAYS) {
    tags.push(<Tag key="fee">{money(fee.feeCents)} fee {inDays(fee.daysLeft)}</Tag>);
  }

  const bonus = bonusStatus(account, today);
  if (bonus && account.bonus) {
    if (bonus.daysLeft < 0) {
      tones.push("alert");
      tags.push(<Tag key="bonus" tone="alert">Bonus deadline passed {shortDate(bonus.deadline)}: earned it?</Tag>);
    } else {
      tones.push("due");
      const spend = account.bonus.spendCents ? `spend ${money(account.bonus.spendCents)}` : "earn";
      tags.push(<Tag key="bonus" tone="due">{bonusLabel(account.bonus)}: {spend} by {shortDate(bonus.deadline)} · {bonus.daysLeft}d left</Tag>);
    }
  }

  if (account.status === "pending") {
    tones.push("info");
    const applied = parseDate(account.appliedOn);
    tags.push(<Tag key="pending" tone="info">Pending · applied {shortDate(account.appliedOn)}{applied ? ` (${daysBetween(applied, today)}d)` : ""}</Tag>);
  }
  if (holding.change !== "opened") {
    const started = parseDate(holding.startedOn);
    const previous = portfolio.holdingsOf(account.id).filter((item) => item.startedOn < holding.startedOn).pop();
    if (started && previous && daysBetween(started, today) <= RECENT_CHANGE_DAYS) {
      tags.push(<Tag key="change">{holding.change === "upgrade" ? "Upgraded" : "Downgraded"} {shortDate(holding.startedOn)}</Tag>);
    }
  }
  if (account.status === "closed") tags.push(<Tag key="closed">Closed {monthYear(account.closedOn)}</Tag>);
  if (account.status === "declined") tags.push(<Tag key="declined">Declined {shortDate(account.closedOn || account.appliedOn)}</Tag>);
  if (kept) tones.push("kept");
  return { tone: tones[0] ?? null, tags, bonusInProgress: Boolean(bonus) };
}

/** The offer as a pill, always in the same shape: green once earned, amber while in progress. */
function BonusPill({ account, today }: { account: Account; today: Date }) {
  if (!account.bonus) return null;
  const text = `${bonusLabel(account.bonus)}${account.bonus.spendCents ? ` / ${money(account.bonus.spendCents)}` : ""}`;
  if (account.status === "pending" || account.status === "declined") return <Tag title="Offer">{text}</Tag>;
  if (account.bonusEarned) return <Tag tone="ok" title="Bonus earned">✓ {text}</Tag>;
  const bonus = bonusStatus(account, today);
  if (bonus) return <Tag tone={bonus.daysLeft < 0 ? "alert" : "due"} title="Bonus in progress">{text}</Tag>;
  return <Tag title="Bonus not earned">{text}</Tag>;
}

function History({ portfolio, account }: { portfolio: Portfolio; account: Account }) {
  const holdings = portfolio.holdingsOf(account.id);
  if (holdings.length < 2) return null;
  return <span className="sub">was {holdings.slice(0, -1).map((holding) => holdingName(portfolio, holding)).join(" → ")}</span>;
}

const openedLabel = (account: Account) => (account.approvedOn ? monthYear(account.approvedOn) : account.appliedOn ? `Applied ${shortDate(account.appliedOn)}` : "—");

/**
 * The main list of accounts, newest first. A table on wide screens and stacked tiles on
 * phones (both are rendered; CSS shows one). Rows that need something are shaded.
 */
export function CardList({ portfolio, accounts, today, onOpenAccount }: Props) {
  const [only, setOnly] = useState<Tone | null>(null);
  const all = accounts.map((account) => {
    const holding = portfolio.current(account.id)!;
    return { account, holding, person: portfolio.person(account.personId), status: cardStatus(portfolio, account, holding, today) };
  });
  const counts = { alert: 0, due: 0, info: 0, kept: 0 };
  for (const row of all) if (row.status.tone) counts[row.status.tone] += 1;
  const filter = only && counts[only] ? only : null;
  const rows = filter ? all.filter((row) => row.status.tone === filter) : all;
  if (!rows.length) return <div className="empty">No cards match.</div>;
  const keyItem = (tone: Tone, label: string) => counts[tone] > 0 && (
    <button type="button" className={`flag-key-item ${tone}`} aria-pressed={filter === tone} onClick={() => setOnly(filter === tone ? null : tone)}><i />{label}</button>
  );
  const rowClass = (account: Account, tone: Tone | null) => [tone ? `flag-${tone}` : "", account.status === "declined" || account.status === "closed" ? "dim" : ""].join(" ");

  return (
    <>
      {(counts.alert > 0 || counts.due > 0 || counts.info > 0 || counts.kept > 0) && (
        <div className="flag-key" role="group" aria-label="Show only">
          {keyItem("alert", `${counts.alert} to decide`)}
          {keyItem("due", `${counts.due} bonus${counts.due === 1 ? "" : "es"} in progress`)}
          {keyItem("info", `${counts.info} pending`)}
          {keyItem("kept", `${counts.kept} kept with a fee`)}
          {filter && <button type="button" className="flag-key-clear" onClick={() => setOnly(null)}>Show all</button>}
        </div>
      )}
      <section className="group">
        <div className="card-table table-wrap">
          <table>
            <thead>
              <tr><th className="sticky">Card</th><th>Opened</th><th>Status</th><th>Bonus</th><th className="num">Fee</th><th>How</th><th>Applied</th><th>Closed</th></tr>
            </thead>
            <tbody>
              {rows.map(({ account, holding, person, status }) => (
                <tr key={account.id} className={`row ${rowClass(account, status.tone)}`} onClick={() => onOpenAccount(account.id)}>
                  <td className="sticky">
                    <span className="who"><Dot name={person?.name || "?"} tone={personTone(person?.sort ?? 0)} />{holdingName(portfolio, holding)}</span>
                    <History portfolio={portfolio} account={account} />
                  </td>
                  <td className="opened num">{openedLabel(account)}</td>
                  <td><div className="status">{status.tags}</div></td>
                  <td><BonusPill account={account} today={today} /></td>
                  <td className="num">{holding.annualFeeCents ? money(holding.annualFeeCents) : "—"}</td>
                  <td>{VIA_LABELS[account.openedVia]}</td>
                  <td className="num">{account.appliedOn || "—"}</td>
                  <td className="num">{account.status === "closed" || account.status === "declined" ? account.closedOn || "—" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="tiles" aria-label="Cards">
          {rows.map(({ account, holding, person, status }) => (
            <li key={account.id}>
              <button type="button" className={`tile ${rowClass(account, status.tone)}`} onClick={() => onOpenAccount(account.id)}>
                <span className="tile-title">
                  <span className="who">
                    <Dot name={person?.name || "?"} tone={personTone(person?.sort ?? 0)} /><strong>{holdingName(portfolio, holding)}</strong>
                    {holding.last4 && <span className="last4 num">··{holding.last4}</span>}
                  </span>
                  <span className="opened num">{openedLabel(account)}</span>
                </span>
                <span className="tile-facts">{[holding.annualFeeCents ? `${money(holding.annualFeeCents)} fee` : "No fee", VIA_LABELS[account.openedVia]].join(" · ")}</span>
                {(account.bonus || status.tags.length > 0) && <span className="status">{!status.bonusInProgress && <BonusPill account={account} today={today} />}{status.tags}</span>}
                <History portfolio={portfolio} account={account} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
