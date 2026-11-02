"use client";

import { creditColumn, creditIsDue, creditState, eligibleHoldings, DUE_WINDOW_DAYS } from "../lib/core/credits";
import type { CardPlaidView } from "../lib/core/card-plaid";
import { holdingName, shortName, type Account, type Credit, type Portfolio } from "../lib/core/model";
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
  /** Closed cards and earlier products (before an upgrade or downgrade) are hidden unless set. */
  showClosed: boolean;
  onShowClosed: (show: boolean) => void;
  /** Bank details for linked cards: status tags and cells with a suggested credit use. */
  plaid?: CardPlaidView | null;
};

/** A card type's heading; the button inside the h2 toggles the group and covers the whole row. */
function GroupHead({ id, title, meta, collapsed, onToggle }: { id: string; title: string; meta: string; collapsed: boolean; onToggle: (key: string) => void }) {
  return (
    <div className="group-head collapsible">
      <span className="caret" aria-hidden="true">▾</span>
      <h2><button type="button" aria-expanded={!collapsed} onClick={() => onToggle(id)}>{title}</button></h2>
      <span className="meta">{meta}</span>
    </div>
  );
}

export const groupId = (key: string) => `g-${key.replace(/[^a-z0-9]+/gi, "-")}`;

/** Card types with credits: one row per card, one checkbox column per credit. */
export function CardGroups(props: GroupProps) {
  const { portfolio, today, include, collapsed, onCollapse, showClosed, onShowClosed, plaid } = props;
  const suggested = new Set((plaid?.suggestions || []).map((suggestion) => `${suggestion.credit.id}:${suggestion.holding.id}`));
  let closedRows = 0;
  // "Not using" credits stay out of the grid; always-used ones come after the tracked ones.
  const visibleCredits = portfolio.credits.filter((credit) => credit.mode !== "skip");
  const notUsing = portfolio.credits.length - visibleCredits.length;
  const productsWithCredits = [...new Set(visibleCredits.map((credit) => credit.productId))];

  const groups = productsWithCredits.map((productId) => {
    const product = portfolio.product(productId)!;
    const credits = visibleCredits.filter((credit) => credit.productId === productId)
      .sort((left, right) => Number(left.mode === "auto") - Number(right.mode === "auto") || left.sort - right.sort);
    const eligible = new Map(credits.map((credit) => [credit.id, new Set(eligibleHoldings(portfolio, credit, today).map((holding) => holding.id))]));
    const rows = portfolio.holdings.filter((holding) => {
      if (holding.productId !== productId) return false;
      const account = portfolio.account(holding.accountId);
      if (!account || !include(account)) return false;
      const isCurrentOpen = account.status === "open" && portfolio.current(account.id)?.id === holding.id;
      const hasCredit = credits.some((credit) => eligible.get(credit.id)!.has(holding.id));
      if (isCurrentOpen) return true;
      if (hasCredit) closedRows += 1;
      return hasCredit && showClosed;
    }).sort((left, right) => {
      const leftOpen = portfolio.current(left.accountId)?.id === left.id && portfolio.account(left.accountId)?.status === "open";
      const rightOpen = portfolio.current(right.accountId)?.id === right.id && portfolio.account(right.accountId)?.status === "open";
      return Number(rightOpen) - Number(leftOpen) || left.startedOn.localeCompare(right.startedOn);
    });
    const columns = credits.filter((credit) => rows.some((holding) => eligible.get(credit.id)!.has(holding.id)))
      .map((credit) => ({ credit, ...creditColumn(portfolio, credit, rows.filter((holding) => eligible.get(credit.id)!.has(holding.id)), today) }));
    return { product, columns, eligible, rows };
  }).filter((group) => group.rows.length)
    .sort((left, right) => right.rows.length - left.rows.length || left.product.name.localeCompare(right.product.name));

  return (
    <>
      {groups.length === 0 && (
        <div className="empty">No cards with credits match.{notUsing > 0 && " Credits marked “Not using” are in Settings → Card types and credits."}</div>
      )}
      {groups.map(({ product, columns, eligible, rows }) => {
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
                    {columns.map((column) => <CreditHeader key={column.credit.id} {...column} />)}
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
                        {columns.map(({ credit }) => {
                          if (!eligible.get(credit.id)!.has(holding.id)) return <td key={credit.id} className="credit" />;
                          const state = creditState(portfolio, credit, holding, today);
                          return (
                            <td key={credit.id} className="credit">
                              <CreditCell credit={credit} state={state} due={creditIsDue(credit, state)} label={`${credit.name} on ${holdingName(portfolio, holding)}`}
                                onToggle={() => props.onToggle({ credit, holding })} onMenu={(anchor) => props.onMenu({ credit, holding }, anchor)} suggested={suggested.has(`${credit.id}:${holding.id}`)} />
                            </td>
                          );
                        })}
                        <td className="status-cell"><StatusTags portfolio={portfolio} account={account} holding={holding} today={today} plaid={plaid?.byAccount.get(account.id)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
                {columns.length > 0 && (
                  <tfoot>
                    <tr>
                      <td className="sticky">Used this period</td>
                      <td />
                      {columns.map(({ credit, summary, due }) => <td key={credit.id} className={`credit num ${due ? "due-col" : ""}`}>{summary.used}/{summary.enrolled}</td>)}
                      <td className="status-cell" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>
        );
      })}
      {closedRows > 0 && (
        <button type="button" className="btn show-closed" aria-pressed={showClosed} onClick={() => onShowClosed(!showClosed)}>
          {showClosed ? "Hide closed cards" : `Show closed cards (${closedRows})`}
        </button>
      )}
    </>
  );
}

function CreditHeader({ credit, period, daysLeft, due }: { credit: Credit } & Pick<ReturnType<typeof creditColumn>, "period" | "daysLeft" | "due">) {
  const cardYear = credit.cadence === "card_year";
  const auto = credit.mode === "auto";
  const meta = auto ? "Always used" : cardYear ? "per card year" : `${period.label} · ${daysLeft <= DUE_WINDOW_DAYS ? `ends ${inDays(daysLeft)}` : `ends ${shortDate(period.end)}`}`;
  const title = auto ? "Always used: counted as used every period without ticking. Change it in Settings." : credit.remind ? undefined : "Tracked quietly: left out of To do";
  return (
    <th className={`credit ${auto ? "auto-col" : credit.remind ? "" : "muted"} ${due ? "due-col" : ""}`} title={title}>
      <span className="cname">{credit.name}</span>
      <span className="cmeta num">{money(credit.amountCents)}</span>
      <span className="cmeta">{meta}</span>
    </th>
  );
}
