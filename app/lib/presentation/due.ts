import { bonusLabel, holdingName, shortName, type Account, type Portfolio } from "../core/model.ts";
import type { DueItem } from "../core/stats.ts";
import { inDays, money, shortDate } from "./format.ts";

/** How a to-do item reads in the app and to agents: a label, the text, and when it's due. */
export function dueText(portfolio: Portfolio, item: DueItem) {
  const who = (account: Account) => {
    const holding = portfolio.current(account.id);
    return holding ? holdingName(portfolio, holding) : portfolio.person(account.personId)?.name || "";
  };
  switch (item.kind) {
    case "credit":
      return { label: "Credit", text: `${item.credit.name} ${money(item.credit.amountCents)} on ${shortName(portfolio.product(item.credit.productId))}: ${item.holdings.length} card${item.holdings.length === 1 ? "" : "s"} left`, when: `${item.period.label} ends ${inDays(item.daysLeft)}` };
    case "review":
      return { label: "Review", text: `${item.rule.name}: ${who(item.account)}`, when: "" };
    case "bonus":
      return item.daysLeft < 0
        ? { label: "Bonus", text: `Mark the ${bonusLabel(item.account.bonus!)} bonus earned, or note what happened: ${who(item.account)}`, when: `deadline was ${shortDate(item.deadline)}` }
        : { label: "Bonus", text: `Spend ${item.account.bonus?.spendCents ? money(item.account.bonus.spendCents) : "the minimum"} for ${bonusLabel(item.account.bonus!)}: ${who(item.account)}`, when: `by ${shortDate(item.deadline)} (${inDays(item.daysLeft)})` };
    case "pending":
      return { label: "Pending", text: `${who(item.account)} application`, when: `applied ${item.daysWaiting}d ago` };
  }
}
