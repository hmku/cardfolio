"use client";

import type { ReactNode } from "react";
import { creditIsDue, creditState, creditSummary, eligibleHoldings, periodFor, DUE_WINDOW_DAYS } from "../lib/core/credits";
import { daysBetween, parseDate } from "../lib/core/dates";
import { bonusLabel, cardTag, holdingName, shortName, type Account, type Credit, type Holding, type Portfolio } from "../lib/core/model";
import { accountAction } from "../lib/core/rules";
import { bonusStatus, BONUS_WINDOW_DAYS, feeStatus } from "../lib/core/stats";
import { CreditCell } from "./CreditCell";
import { Dot, inDays, money, monthYear, personTone, shortDate, Tag } from "./ui";

export type CellTarget = { credit: Credit; holding: Holding };

type Handlers = {
  onOpenAccount: (accountId: number) => void;
  onToggle: (target: CellTarget) => void;
  onMenu: (target: CellTarget, anchor: DOMRect) => void;
};

type GroupProps = Handlers & {
  portfolio: Portfolio;
  today: Date;
  include: (account: Account) => boolean;
  dueOnly: boolean;
  dueHoldings: Set<number>;
  collapsed: Record<string, boolean>;
  onCollapse: (key: string) => void;
};

const FEE_WINDOW_DAYS = 45;
const RECENT_CHANGE_DAYS = 120;

export function WhoLabel({ portfolio, holding, withProduct }: { portfolio: Portfolio; holding: Holding; withProduct?: boolean }) {
  const person = portfolio.person(holding.personId);
  const name = person?.name || "Unknown";
  return (
    <span className="who">
      <Dot name={name} tone={personTone(person?.sort ?? 0)} />
      {withProduct ? holdingName(portfolio, holding) : <span className="num" title={name}>{cardTag(portfolio, holding) || name}</span>}
      {holding.last4 && <span className="last4 num">··{holding.last4}</span>}
    </span>
  );
}

/** The tags that explain what's going on with a card, most urgent first. */
export function StatusTags({ portfolio, account, holding, today }: { portfolio: Portfolio; account: Account; holding: Holding; today: Date }) {
  const current = portfolio.current(account.id);
  const tags: ReactNode[] = [];
  if (current && current.id !== holding.id) {
    tags.push(account.status === "open"
      ? <Tag key="now">Now {holdingName(portfolio, current)}</Tag>
      : <Tag key="closed">Closed {shortDate(account.closedOn)}</Tag>);
    return <div className="status">{tags}</div>;
  }
  const rule = accountAction(portfolio, account, today);
  if (rule) tags.push(<Tag key="rule" tone="alert" title={rule.name}>{rule.name}</Tag>);
  const bonus = bonusStatus(account, today);
  if (bonus && account.bonus) {
    tags.push(bonus.daysLeft < 0
      ? <Tag key="bonus" tone="alert">{bonusLabel(account.bonus)} bonus not marked earned · deadline was {shortDate(bonus.deadline)}</Tag>
      : <Tag key="bonus" tone={bonus.daysLeft <= BONUS_WINDOW_DAYS ? "due" : undefined}>{bonusLabel(account.bonus)} bonus · {account.bonus.spendCents ? `spend ${money(account.bonus.spendCents)} by ` : "by "}{shortDate(bonus.deadline)} <span className="num">({inDays(bonus.daysLeft)})</span></Tag>);
  }
  const fee = feeStatus(portfolio, account, today);
  if (fee && fee.daysLeft <= FEE_WINDOW_DAYS) tags.push(<Tag key="fee" tone="due">{money(fee.feeCents)} fee {inDays(fee.daysLeft)}</Tag>);
  if (holding.change !== "opened") {
    const started = parseDate(holding.startedOn);
    const previous = portfolio.holdingsOf(account.id).filter((item) => item.startedOn < holding.startedOn).pop();
    if (started && previous && daysBetween(started, today) <= RECENT_CHANGE_DAYS) {
      tags.push(<Tag key="change">{holding.change === "upgrade" ? "Upgraded" : "Downgraded"} from {holdingName(portfolio, previous)} {shortDate(holding.startedOn)}</Tag>);
    }
  }
  if (account.status === "closed") tags.push(<Tag key="closed">Closed {shortDate(account.closedOn)}</Tag>);
  if (account.status === "pending") tags.push(<Tag key="pending" tone="due">Pending · applied {shortDate(account.appliedOn)}</Tag>);
  return <div className="status">{tags}</div>;
}

function GroupHead({ id, title, meta, collapsed, onToggle }: { id: string; title: string; meta: string; collapsed: boolean; onToggle: (key: string) => void }) {
  return (
    <button type="button" className="group-head" aria-expanded={!collapsed} onClick={() => onToggle(id)}>
      <span className="caret" aria-hidden="true">▾</span>
      <h2>{title}</h2>
      <span className="meta">{meta}</span>
    </button>
  );
}

export const groupId = (key: string) => `g-${key.replace(/[^a-z0-9]+/gi, "-")}`;

/** Card types with credits: one row per card, one checkbox column per credit. */
export function CardGroups(props: GroupProps) {
  const { portfolio, today, include, dueOnly, dueHoldings, collapsed, onCollapse } = props;
  const productsWithCredits = [...new Set(portfolio.credits.map((credit) => credit.productId))];

  const groups = productsWithCredits.map((productId) => {
    const product = portfolio.product(productId)!;
    const credits = portfolio.credits.filter((credit) => credit.productId === productId).sort((left, right) => left.sort - right.sort);
    const eligible = new Map(credits.map((credit) => [credit.id, new Set(eligibleHoldings(portfolio, credit, today).map((holding) => holding.id))]));
    const rows = portfolio.holdings.filter((holding) => {
      if (holding.productId !== productId) return false;
      const account = portfolio.account(holding.accountId);
      if (!account || !include(account)) return false;
      const isCurrentOpen = account.status === "open" && portfolio.current(account.id)?.id === holding.id;
      const hasCredit = credits.some((credit) => eligible.get(credit.id)!.has(holding.id));
      if (!isCurrentOpen && !hasCredit) return false;
      return !dueOnly || dueHoldings.has(holding.id);
    }).sort((left, right) => {
      const leftOpen = portfolio.current(left.accountId)?.id === left.id && portfolio.account(left.accountId)?.status === "open";
      const rightOpen = portfolio.current(right.accountId)?.id === right.id && portfolio.account(right.accountId)?.status === "open";
      return Number(rightOpen) - Number(leftOpen) || left.startedOn.localeCompare(right.startedOn);
    });
    const columns = credits.filter((credit) => rows.some((holding) => eligible.get(credit.id)!.has(holding.id)));
    return { product, credits: columns, eligible, rows };
  }).filter((group) => group.rows.length)
    .sort((left, right) => right.rows.length - left.rows.length || left.product.name.localeCompare(right.product.name));

  return (
    <>
      {groups.map(({ product, credits, eligible, rows }) => {
        const key = `product-${product.id}`;
        const isCollapsed = Boolean(collapsed[key]) && !dueOnly;
        const openRows = rows.filter((holding) => portfolio.account(holding.accountId)?.status === "open" && portfolio.current(holding.accountId)?.id === holding.id);
        const fees = [...new Set(openRows.map((holding) => holding.annualFeeCents).filter(Boolean))].sort((left, right) => left - right);
        const kind = product.kind === "business" ? "Business" : product.kind === "personal" ? "Personal" : "Other";
        return (
          <section key={key} className={`group ${isCollapsed ? "collapsed" : ""}`} id={groupId(product.slug)}>
            <GroupHead id={key} title={product.name} collapsed={isCollapsed} onToggle={onCollapse}
              meta={`${shortName(product)} · ${product.issuer} · ${kind} · ${openRows.length} open${fees.length ? ` · ${fees.map(money).join(" / ")} fee` : " · no fee"}`} />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th className="sticky">Card</th>
                    <th>Opened</th>
                    {credits.map((credit) => <CreditHeader key={credit.id} portfolio={portfolio} credit={credit} rows={rows.filter((holding) => eligible.get(credit.id)!.has(holding.id))} today={today} />)}
                    <th className="status-cell">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((holding) => {
                    const account = portfolio.account(holding.accountId)!;
                    const dim = account.status !== "open" || portfolio.current(account.id)?.id !== holding.id;
                    return (
                      <tr key={holding.id} className={`row ${dim ? "dim" : ""}`} onClick={() => props.onOpenAccount(account.id)}>
                        <td className="sticky"><WhoLabel portfolio={portfolio} holding={holding} /></td>
                        <td className="num">{monthYear(holding.startedOn)}</td>
                        {credits.map((credit) => {
                          if (!eligible.get(credit.id)!.has(holding.id)) return <td key={credit.id} className="credit" />;
                          const state = creditState(portfolio, credit, holding, today);
                          return (
                            <td key={credit.id} className="credit">
                              <CreditCell credit={credit} state={state} due={creditIsDue(credit, state)} label={`${credit.name} on ${holdingName(portfolio, holding)}`}
                                onToggle={() => props.onToggle({ credit, holding })} onMenu={(anchor) => props.onMenu({ credit, holding }, anchor)} />
                            </td>
                          );
                        })}
                        <td className="status-cell"><StatusTags portfolio={portfolio} account={account} holding={holding} today={today} /></td>
                      </tr>
                    );
                  })}
                </tbody>
                {credits.length > 0 && (
                  <tfoot>
                    <tr>
                      <td className="sticky">Used this period</td>
                      <td />
                      {credits.map((credit) => {
                        const holdings = rows.filter((holding) => eligible.get(credit.id)!.has(holding.id));
                        const summary = creditSummary(portfolio, credit, holdings, today);
                        const period = periodFor(portfolio, credit, null, today);
                        const due = credit.remind && credit.cadence !== "card_year" && summary.used < summary.enrolled && daysBetween(today, period.end) <= DUE_WINDOW_DAYS;
                        return <td key={credit.id} className={`credit num ${due ? "due-col" : ""}`}>{summary.used}/{summary.enrolled}</td>;
                      })}
                      <td className="status-cell" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}

function CreditHeader({ portfolio, credit, rows, today }: { portfolio: Portfolio; credit: Credit; rows: Holding[]; today: Date }) {
  const period = periodFor(portfolio, credit, null, today);
  const daysLeft = daysBetween(today, period.end);
  const cardYear = credit.cadence === "card_year";
  const summary = creditSummary(portfolio, credit, rows, today);
  const due = credit.remind && !cardYear && daysLeft <= DUE_WINDOW_DAYS && summary.used < summary.enrolled;
  const meta = cardYear ? "per card year" : `${period.label} · ${daysLeft <= DUE_WINDOW_DAYS ? `ends ${inDays(daysLeft)}` : `ends ${shortDate(period.end)}`}`;
  return (
    <th className={`credit ${credit.remind ? "" : "muted"} ${due ? "due-col" : ""}`} title={credit.remind ? undefined : "Low priority: left out of Due soon"}>
      <span className="cname">{credit.name}</span>
      <span className="cmeta num">{money(credit.amountCents)}</span>
      <span className="cmeta">{meta}</span>
    </th>
  );
}

/** Open cards whose card type has no credits, in one table. */
export function OtherCards({ portfolio, today, include, dueOnly, dueHoldings, collapsed, onCollapse, onOpenAccount }: GroupProps) {
  const withCredits = new Set(portfolio.credits.map((credit) => credit.productId));
  const rows = portfolio.accounts
    .filter((account) => account.status === "open" && include(account))
    .map((account) => ({ account, holding: portfolio.current(account.id)! }))
    .filter(({ holding }) => holding && !withCredits.has(holding.productId) && (!dueOnly || dueHoldings.has(holding.id)))
    .sort((left, right) => shortName(portfolio.product(left.holding.productId)).localeCompare(shortName(portfolio.product(right.holding.productId))) || left.holding.startedOn.localeCompare(right.holding.startedOn));
  if (!rows.length) return null;
  const isCollapsed = Boolean(collapsed.other) && !dueOnly;
  return (
    <section className={`group ${isCollapsed ? "collapsed" : ""}`} id="g-other">
      <GroupHead id="other" title="Other open cards" meta={`${rows.length} card${rows.length === 1 ? "" : "s"} with no credits to track`} collapsed={isCollapsed} onToggle={onCollapse} />
      <div className="table-wrap">
        <table>
          <thead><tr><th className="sticky">Card</th><th>Cardholder</th><th>Opened</th><th className="num">Fee</th><th className="status-cell">Status</th></tr></thead>
          <tbody>
            {rows.map(({ account, holding }) => (
              <tr key={account.id} className="row" onClick={() => onOpenAccount(account.id)}>
                <td className="sticky">{shortName(portfolio.product(holding.productId))}</td>
                <td><WhoLabel portfolio={portfolio} holding={holding} /></td>
                <td className="num">{monthYear(holding.startedOn)}</td>
                <td className="num">{holding.annualFeeCents ? money(holding.annualFeeCents) : "—"}</td>
                <td className="status-cell"><StatusTags portfolio={portfolio} account={account} holding={holding} today={today} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PendingApplications({ portfolio, today, include, onOpenAccount }: Pick<GroupProps, "portfolio" | "today" | "include" | "onOpenAccount">) {
  const pending = portfolio.accounts.filter((account) => account.status === "pending" && include(account));
  if (!pending.length) return null;
  return (
    <section className="group" id="g-pending">
      <div className="group-head"><h2>Waiting on a decision</h2><span className="meta">{pending.length} application{pending.length === 1 ? "" : "s"}</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th className="sticky">Card</th><th>Applied</th><th className="status-cell">Status</th></tr></thead>
          <tbody>
            {pending.map((account) => {
              const holding = portfolio.current(account.id)!;
              return (
                <tr key={account.id} className="row" onClick={() => onOpenAccount(account.id)}>
                  <td className="sticky"><WhoLabel portfolio={portfolio} holding={holding} withProduct /></td>
                  <td className="num">{shortDate(account.appliedOn)}</td>
                  <td className="status-cell">
                    <div className="status">
                      <StatusTags portfolio={portfolio} account={account} holding={holding} today={today} />
                      {account.note && !/pending/i.test(account.note) && <Tag>{account.note}</Tag>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const VIA_LABELS: Record<Account["openedVia"], string> = { applied: "Applied", referral: "Referral", nll_offer: "NLL offer", product_change: "Product change", other: "Other" };

/** The flat ledger: one row per account, newest application first. */
export function TimelineTable({ portfolio, accounts, onOpenAccount }: { portfolio: Portfolio; accounts: Account[]; onOpenAccount: (id: number) => void }) {
  return (
    <table>
      <thead><tr><th className="sticky">Card</th><th>Cardholder</th><th>Applied</th><th>Approved</th><th>How</th><th>Bonus</th><th className="num">Fee</th><th className="status-cell">Outcome</th></tr></thead>
      <tbody>
        {accounts.map((account) => {
          const holdings = portfolio.holdingsOf(account.id);
          const current = portfolio.current(account.id)!;
          const person = portfolio.person(account.personId);
          const outcome = account.status === "open" ? <Tag tone="ok">Open</Tag>
            : account.status === "pending" ? <Tag tone="due">Pending</Tag>
            : account.status === "declined" ? <Tag>Declined</Tag>
            : <Tag>Closed {shortDate(account.closedOn)}, {parseDate(account.closedOn)?.getFullYear()}</Tag>;
          return (
            <tr key={account.id} className={`row ${account.status === "declined" ? "dim" : ""}`} onClick={() => onOpenAccount(account.id)}>
              <td className="sticky">
                {holdingName(portfolio, current)}
                {holdings.length > 1 && <div className="sub">was {holdings.slice(0, -1).map((holding) => holdingName(portfolio, holding)).join(" → ")}</div>}
              </td>
              <td><span className="who"><Dot name={person?.name || "?"} tone={personTone(person?.sort ?? 0)} />{person?.name}</span></td>
              <td className="num">{account.appliedOn || "—"}</td>
              <td className="num">{account.approvedOn || "—"}</td>
              <td>{VIA_LABELS[account.openedVia]}</td>
              <td>
                {account.bonus ? <>{bonusLabel(account.bonus)}{account.bonus.spendCents ? ` / ${money(account.bonus.spendCents)}` : ""}{" "}
                  {account.status !== "declined" && account.status !== "pending" && (account.bonusEarned ? <Tag tone="ok">earned</Tag> : <Tag tone="due">in progress</Tag>)}</> : "—"}
              </td>
              <td className="num">{current.annualFeeCents ? money(current.annualFeeCents) : "—"}</td>
              <td className="status-cell"><div className="status">{outcome}{account.note && <Tag>{account.note}</Tag>}</div></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
