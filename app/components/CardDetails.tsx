import { bonusLabel, cardTag, holdingName, type Account, type Holding, type Portfolio } from "../lib/core/model";
import { bonusStatus } from "../lib/core/stats";
import type { BonusProgress, CardPlaidSummary } from "../lib/core/card-plaid";
import { bonusHistoryWarning, bonusProgressText } from "../lib/presentation/card-plaid";
import { cardStatus, type StatusTag } from "../lib/presentation/card-status";
import { money } from "../lib/presentation/format";
import { Dot, personTone, Tag } from "./ui";

/** The same identity (including last digits) in desktop rows, phone tiles and credit grids. */
export function WhoLabel({ portfolio, holding, withProduct }: { portfolio: Portfolio; holding: Holding; withProduct?: boolean }) {
  const person = portfolio.person(holding.personId);
  const name = person?.name || "Unknown";
  return <span className="who">
    <Dot name={name} tone={personTone(person?.sort ?? 0)} />
    <span title={name} className={withProduct ? undefined : "num"}>{withProduct ? holdingName(portfolio, holding) : cardTag(portfolio, holding) || name}</span>
    {holding.last4 && <span className="last4 num">··{holding.last4}</span>}
  </span>;
}

export function StatusTagList({ tags }: { tags: StatusTag[] }) {
  return <>{tags.map(({ key, text, tone, title }) => <Tag key={key} tone={tone} title={title}>{text}</Tag>)}</>;
}

export function StatusTags({ portfolio, account, holding, today, plaid }: { portfolio: Portfolio; account: Account; holding: Holding; today: Date; plaid?: CardPlaidSummary | null }) {
  return <div className="status"><StatusTagList tags={cardStatus(portfolio, account, holding, today, plaid).tags} /></div>;
}

/** The bonus offer; while in progress on a Plaid-linked card it also shows spend so far. */
export function BonusPill({ account, today, progress }: { account: Account; today: Date; progress?: BonusProgress | null }) {
  if (!account.bonus) return null;
  const text = `${bonusLabel(account.bonus)}${account.bonus.spendCents ? ` / ${money(account.bonus.spendCents)}` : ""}`;
  if (account.status === "pending" || account.status === "declined") return <Tag title="Offer">{text}</Tag>;
  if (account.bonusEarned) return <Tag tone="ok" title="Bonus earned">✓ {text}</Tag>;
  const bonus = bonusStatus(account, today);
  if (bonus && progress) {
    const title = [bonusProgressText(progress), bonusHistoryWarning(progress)].filter(Boolean).join(". ");
    return <Tag tone={bonus.daysLeft < 0 ? "alert" : "due"} title={title}>{bonusLabel(account.bonus)} · {money(progress.spentCents)} of {money(progress.targetCents)}{progress.historyGap ? " *" : ""}</Tag>;
  }
  if (bonus) return <Tag tone={bonus.daysLeft < 0 ? "alert" : "due"} title="Bonus in progress">{text}</Tag>;
  return <Tag title="Bonus not earned">{text}</Tag>;
}
