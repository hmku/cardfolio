"use client";

import { bonusLabel, holdingName, type Account, type Portfolio } from "../lib/core/model";
import { StatusTags } from "./CardGroups";
import { Dot, money, monthYear, personTone, shortDate, Tag } from "./ui";

const VIA_LABELS: Record<Account["openedVia"], string> = { applied: "Applied", referral: "Referral", nll_offer: "NLL offer", product_change: "Product change", other: "Other" };

type Props = { portfolio: Portfolio; accounts: Account[]; today: Date; onOpenAccount: (id: number) => void };

function bonusText(account: Account) {
  if (!account.bonus) return null;
  return `${bonusLabel(account.bonus)}${account.bonus.spendCents ? ` / ${money(account.bonus.spendCents)}` : ""}`;
}

function History({ portfolio, account }: { portfolio: Portfolio; account: Account }) {
  const holdings = portfolio.holdingsOf(account.id);
  if (holdings.length < 2) return null;
  return <div className="sub">was {holdings.slice(0, -1).map((holding) => holdingName(portfolio, holding)).join(" → ")}</div>;
}

/**
 * The main list of accounts, newest first. A table on wide screens and stacked tiles on
 * phones (both are rendered; CSS shows one), so the important details are always visible.
 */
export function CardList({ portfolio, accounts, today, onOpenAccount }: Props) {
  if (!accounts.length) return <div className="empty">No cards match.</div>;
  const rows = accounts.map((account) => ({ account, holding: portfolio.current(account.id)!, person: portfolio.person(account.personId) }));

  return (
    <section className="group">
      <div className="card-table table-wrap">
        <table>
          <thead>
            <tr><th className="sticky">Card</th><th>Status</th><th>Bonus</th><th>Opened</th><th className="num">Fee</th><th>How</th><th>Applied</th><th>Closed</th></tr>
          </thead>
          <tbody>
            {rows.map(({ account, holding, person }) => (
              <tr key={account.id} className={`row ${account.status === "declined" || account.status === "closed" ? "dim" : ""}`} onClick={() => onOpenAccount(account.id)}>
                <td className="sticky">
                  <span className="who"><Dot name={person?.name || "?"} tone={personTone(person?.sort ?? 0)} />{holdingName(portfolio, holding)}</span>
                  <History portfolio={portfolio} account={account} />
                </td>
                <td><StatusTags portfolio={portfolio} account={account} holding={holding} today={today} /></td>
                <td>
                  {bonusText(account) ?? "—"}{" "}
                  {account.bonus && account.status !== "declined" && account.status !== "pending" && account.bonusEarned && <Tag tone="ok">earned</Tag>}
                </td>
                <td className="num">{account.approvedOn ? monthYear(account.approvedOn) : "—"}</td>
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
        {rows.map(({ account, holding, person }) => {
          const opened = account.approvedOn ? `opened ${monthYear(account.approvedOn)}` : `applied ${shortDate(account.appliedOn)}`;
          const facts = [opened, holding.annualFeeCents ? `${money(holding.annualFeeCents)} fee` : "no fee", VIA_LABELS[account.openedVia]];
          const earned = account.bonus && account.bonusEarned && account.status !== "declined" ? `${bonusText(account)} earned` : null;
          return (
            <li key={account.id}>
              <button type="button" className={`tile ${account.status === "declined" || account.status === "closed" ? "dim" : ""}`} onClick={() => onOpenAccount(account.id)}>
                <span className="tile-title">
                  <span className="who"><Dot name={person?.name || "?"} tone={personTone(person?.sort ?? 0)} /><strong>{holdingName(portfolio, holding)}</strong></span>
                  {holding.last4 && <span className="last4 num">··{holding.last4}</span>}
                </span>
                <span className="tile-facts">{facts.join(" · ")}</span>
                <StatusTags portfolio={portfolio} account={account} holding={holding} today={today} />
                {earned && <span className="tile-facts">{earned}</span>}
                <History portfolio={portfolio} account={account} />
                {account.note && <span className="tile-facts">{account.note}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
