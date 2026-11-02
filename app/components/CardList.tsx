"use client";

import { useState } from "react";
import { holdingName, type Account, type Portfolio } from "../lib/core/model";
import type { CardPlaidSummary, CardPlaidView } from "../lib/core/card-plaid";
import { balanceText, paymentText } from "../lib/presentation/card-plaid";
import { cardStatus, type CardTone } from "../lib/presentation/card-status";
import { OPENED_VIA_LABELS } from "../lib/presentation/labels";
import { fullDate, money, monthYear } from "../lib/presentation/format";
import { BonusPill, StatusTagList, WhoLabel } from "./CardDetails";

type Props = {
  portfolio: Portfolio; accounts: Account[]; today: Date; onOpenAccount: (id: number) => void; plaid?: CardPlaidView | null;
  /** Whether a search is filtering the list (changes the empty message). */
  searching?: boolean;
};

function History({ portfolio, account }: { portfolio: Portfolio; account: Account }) {
  const holdings = portfolio.holdingsOf(account.id);
  if (holdings.length < 2) return null;
  return <span className="sub">was {holdings.slice(0, -1).map((holding) => holdingName(portfolio, holding)).join(" → ")}</span>;
}

/** Balance and statement for a Plaid-linked card: "$2,345" over "$1,234 due Nov 20". */
function BalanceCell({ bank }: { bank: CardPlaidSummary | null }) {
  if (!bank) return <>—</>;
  const { payment } = bank;
  const statement = paymentText(payment);
  return <>
    {payment.balanceCents === null ? "—" : money(payment.balanceCents)}
    {statement && <span className={`sub ${payment.overdue ? "alert" : ""}`}>{statement}</span>}
  </>;
}

/** Month opened. Pending cards show "—": the Applied column and the pending tag carry the date. */
const openedLabel = (account: Account) => (account.approvedOn ? monthYear(account.approvedOn) : "—");

/**
 * The main list of accounts, newest first. A table on wide screens and stacked tiles on
 * phones (both are rendered; CSS shows one). Rows that need something are shaded.
 */
export function CardList({ portfolio, accounts, today, onOpenAccount, plaid, searching }: Props) {
  const [only, setOnly] = useState<CardTone | null>(null);
  const all = accounts.map((account) => {
    const holding = portfolio.current(account.id)!;
    const bank = plaid?.byAccount.get(account.id) ?? null;
    return { account, holding, bank, status: cardStatus(portfolio, account, holding, today, bank) };
  });
  const showBalance = Boolean(plaid?.byAccount.size);
  const counts = { alert: 0, due: 0, info: 0, kept: 0 };
  for (const row of all) if (row.status.tone) counts[row.status.tone] += 1;
  const filter = only && counts[only] ? only : null;
  const rows = filter ? all.filter((row) => row.status.tone === filter) : all;
  if (!rows.length) return <div className="empty">{searching ? "No cards match." : "No open or pending cards."}</div>;
  const keyItem = (tone: CardTone, label: string) => counts[tone] > 0 && (
    <button type="button" className={`flag-key-item ${tone}`} aria-pressed={filter === tone} onClick={() => setOnly(filter === tone ? null : tone)}><i />{label}</button>
  );
  const rowClass = (account: Account, tone: CardTone | null) => [tone ? `flag-${tone}` : "", account.status === "declined" || account.status === "closed" ? "dim" : ""].join(" ");

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
              <tr><th className="sticky">Card</th><th>Opened</th><th>Status</th><th>Bonus</th>{showBalance && <th className="r">Balance</th>}<th className="r">Fee</th><th>How</th><th>Applied</th><th>Closed</th></tr>
            </thead>
            <tbody>
              {rows.map(({ account, holding, bank, status }) => (
                <tr key={account.id} className={`row ${rowClass(account, status.tone)}`} onClick={() => onOpenAccount(account.id)}>
                  <td className="sticky">
                    <button type="button" className="card-link" onClick={(event) => { event.stopPropagation(); onOpenAccount(account.id); }}><WhoLabel portfolio={portfolio} holding={holding} withProduct /></button>
                    <History portfolio={portfolio} account={account} />
                  </td>
                  <td className="opened num">{openedLabel(account)}</td>
                  <td><div className="status"><StatusTagList tags={status.tags} /></div></td>
                  <td className="bonus-cell">{!status.bonusInProgress && <BonusPill account={account} today={today} />}</td>
                  {showBalance && <td className="num r balance-cell"><BalanceCell bank={bank} /></td>}
                  <td className="num r">{holding.annualFeeCents ? money(holding.annualFeeCents) : "—"}</td>
                  <td>{OPENED_VIA_LABELS[account.openedVia]}</td>
                  <td className="num">{fullDate(account.appliedOn)}</td>
                  <td className="num">{account.status === "closed" || account.status === "declined" ? fullDate(account.closedOn) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="tiles" aria-label="Cards">
          {rows.map(({ account, holding, bank, status }) => (
            <li key={account.id}>
              <button type="button" className={`tile ${rowClass(account, status.tone)}`} onClick={() => onOpenAccount(account.id)}>
                <span className="tile-title">
                  <WhoLabel portfolio={portfolio} holding={holding} withProduct />
                  {account.approvedOn && <span className="opened num">{openedLabel(account)}</span>}
                </span>
                <span className="tile-facts">{[holding.annualFeeCents ? `${money(holding.annualFeeCents)} fee` : "No fee", OPENED_VIA_LABELS[account.openedVia], ...(bank && account.status === "open" ? [balanceText(bank.payment), bank.payment.overdue ? null : paymentText(bank.payment)] : [])].filter(Boolean).join(" · ")}</span>
                {(account.bonus || status.tags.length > 0) && <span className="status">{!status.bonusInProgress && <BonusPill account={account} today={today} />}<StatusTagList tags={status.tags} /></span>}
                <History portfolio={portfolio} account={account} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
