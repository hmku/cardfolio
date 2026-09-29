"use client";

import { creditIsDue, creditState, creditSummary, eligibleHoldings, periodFor, DUE_WINDOW_DAYS } from "../lib/core/credits";
import { daysBetween } from "../lib/core/dates";
import { holdingName, shortName, type Account, type Credit, type Holding, type Portfolio } from "../lib/core/model";
import { CreditCell, type CellTarget } from "./CreditCell";
import { StatusTags, WhoLabel } from "./CardDetails";
import { inDays, money, monthYear, shortDate } from "../lib/presentation/format";

type Handlers = {
  onOpenAccount: (accountId: number) => void;
  onToggle: (target: CellTarget) => void;
  onMenu: (target: CellTarget, anchor: DOMRect) => void;
};

type GroupProps = Handlers & {
  portfolio: Portfolio;
  today: Date;
  include: (account: Account) => boolean;
  collapsed: Record<string, boolean>;
  onCollapse: (key: string) => void;
};

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
  const { portfolio, today, include, collapsed, onCollapse } = props;
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
      return isCurrentOpen || hasCredit;
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
      {groups.length === 0 && <div className="empty">No cards with credits match.</div>}
      {groups.map(({ product, credits, eligible, rows }) => {
        const key = `product-${product.id}`;
        const isCollapsed = Boolean(collapsed[key]);
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
                        <td className="sticky"><button type="button" className="card-link" onClick={(event) => { event.stopPropagation(); props.onOpenAccount(account.id); }}><WhoLabel portfolio={portfolio} holding={holding} /></button></td>
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
    <th className={`credit ${credit.remind ? "" : "muted"} ${due ? "due-col" : ""}`} title={credit.remind ? undefined : "Low priority: left out of To do"}>
      <span className="cname">{credit.name}</span>
      <span className="cmeta num">{money(credit.amountCents)}</span>
      <span className="cmeta">{meta}</span>
    </th>
  );
}
