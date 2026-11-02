import type { CardPlaidView } from "../core/card-plaid.ts";
import { bonusLabel, holdingName, shortName, type Account, type Portfolio } from "../core/model.ts";
import type { DueItem } from "../core/stats.ts";
import { bonusProgressText, feePostingText } from "./card-plaid.ts";
import { inDays, money, shortDate } from "./format.ts";

/** How a to-do item reads: a label, the text, and when it's due. `plaid` adds bank details when linked. */
export function dueText(portfolio: Portfolio, item: DueItem, plaid?: CardPlaidView | null) {
  const who = (account: Account) => {
    const holding = portfolio.current(account.id);
    return holding ? holdingName(portfolio, holding) : portfolio.person(account.personId)?.name || "";
  };
  const linked = item.kind === "credit" ? undefined : plaid?.byAccount.get(item.account.id);
  switch (item.kind) {
    case "credit":
      return { label: "Credit", text: `${item.credit.name} ${money(item.credit.amountCents)} on ${shortName(portfolio.product(item.credit.productId))}: ${item.holdings.length} card${item.holdings.length === 1 ? "" : "s"} left`, when: `${item.period.label} ends ${inDays(item.daysLeft)}` };
    case "review":
      return { label: "Review", text: `${item.rule.name}: ${who(item.account)}`, when: linked?.fee ? feePostingText(linked.fee) : "" };
    case "bonus": {
      if (item.daysLeft < 0) return { label: "Bonus", text: `Mark the ${bonusLabel(item.account.bonus!)} bonus earned, or note what happened: ${who(item.account)}`, when: `deadline was ${shortDate(item.deadline)}` };
      const progress = linked?.bonus;
      if (progress) return { label: "Bonus", text: `${bonusLabel(item.account.bonus!)}: ${who(item.account)} · ${bonusProgressText(progress)}`, when: `by ${shortDate(item.deadline)}` };
      return { label: "Bonus", text: `Spend ${item.account.bonus?.spendCents ? money(item.account.bonus.spendCents) : "the minimum"} for ${bonusLabel(item.account.bonus!)}: ${who(item.account)}`, when: `by ${shortDate(item.deadline)} (${inDays(item.daysLeft)})` };
    }
    case "payment": {
      const { payment } = item;
      if (payment.overdue) return { label: "Overdue", text: `${who(item.account)} payment is overdue${payment.minimumCents ? `: pay at least ${money(payment.minimumCents)}` : ""}`, when: payment.dueDate ? `was due ${shortDate(payment.dueDate)}` : "" };
      return { label: "Pay", text: `${money(payment.remainingCents)} statement balance on ${who(item.account)}`, when: `due ${shortDate(payment.dueDate)} (${inDays(payment.daysLeft ?? 0)})` };
    }
    case "pending":
      return { label: "Pending", text: `${who(item.account)} application`, when: `applied ${item.daysWaiting}d ago` };
  }
}
