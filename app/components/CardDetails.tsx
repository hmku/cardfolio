import { bonusLabel, cardTag, holdingName, type Account, type Holding, type Portfolio } from "../lib/core/model";
import { bonusStatus } from "../lib/core/stats";
import type { CardPlaidSummary } from "../lib/core/card-plaid";
import { cardStatus, type StatusTag } from "../lib/presentation/card-status";
import { money } from "../lib/presentation/format";
import { Dot, personTone, Tag } from "./ui";

/**
 * The same identity (including last digits) in desktop rows, phone tiles and credit grids.
 * One line that never wraps: a long name is cut with an ellipsis, the digits always stay.
 */
export function WhoLabel({ portfolio, holding, withProduct }: { portfolio: Portfolio; holding: Holding; withProduct?: boolean }) {
  const person = portfolio.person(holding.personId);
  const name = person?.name || "Unknown";
  return <span className="who">
    <Dot name={name} tone={personTone(person?.sort ?? 0)} />
    <span title={name} className="who-name">{withProduct ? holdingName(portfolio, holding) : cardTag(portfolio, holding) || name}</span>
    {holding.last4 && <span className="last4 num">··{holding.last4}</span>}
  </span>;
}

export function StatusTagList({ tags }: { tags: StatusTag[] }) {
  return <>{tags.map(({ key, text, tone, title }) => <Tag key={key} tone={tone} title={title}>{text}</Tag>)}</>;
}

export function StatusTags({ portfolio, account, holding, today, plaid }: { portfolio: Portfolio; account: Account; holding: Holding; today: Date; plaid?: CardPlaidSummary | null }) {
  return <div className="status"><StatusTagList tags={cardStatus(portfolio, account, holding, today, plaid).tags} /></div>;
}

/**
 * The bonus offer. Callers hide it while the bonus is in progress: the status "bonus" tag then
 * carries the deadline and (for Plaid-linked cards) the spend so far.
 */
export function BonusPill({ account, today }: { account: Account; today: Date }) {
  if (!account.bonus) return null;
  const text = `${bonusLabel(account.bonus)}${account.bonus.spendCents ? ` / ${money(account.bonus.spendCents)}` : ""}`;
  if (account.status === "pending" || account.status === "declined") return <Tag title="Offer">{text}</Tag>;
  if (account.bonusEarned) return <Tag tone="ok" title="Bonus earned">✓ {text}</Tag>;
  const bonus = bonusStatus(account, today);
  if (bonus) return <Tag tone={bonus.daysLeft < 0 ? "alert" : "due"} title="Bonus in progress">{text}</Tag>;
  return <Tag title="Bonus not earned">{text}</Tag>;
}
