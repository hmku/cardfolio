"use client";

import { useState } from "react";
import { bonusLabel, holdingName, shortName, type Account, type Portfolio, type Product } from "../lib/core/model";
import type { DueItem } from "../lib/core/stats";
import { inDays, money, shortDate } from "../lib/presentation/format";

const TODO_PREVIEW = 5;

function dueText(portfolio: Portfolio, item: DueItem) {
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

export function DueList({ portfolio, items, onOpenAccount, onOpenCredits }: {
  portfolio: Portfolio;
  items: DueItem[];
  onOpenAccount: (id: number) => void;
  onOpenCredits: (product: Product) => void;
}) {
  const [showAllTodos, setShowAllTodos] = useState(false);
  if (!items.length) return null;
  return (
    <section className="todo" aria-label="To do">
      <div className="todo-head"><h2>To do</h2><span className="meta num">{items.length}</span></div>
      <div className="due-list">
        {(showAllTodos ? items : items.slice(0, TODO_PREVIEW)).map((item, index) => {
          const text = dueText(portfolio, item);
          const accountId = item.kind === "credit" ? null : item.account.id;
          const product = item.kind === "credit" ? portfolio.product(item.credit.productId) : undefined;
          return (
            <button key={index} type="button" className="due-item" onClick={() => {
              if (accountId !== null) onOpenAccount(accountId);
              else if (product) onOpenCredits(product);
            }}>
              <span className="due-kind">{text.label}</span><span>{text.text}</span><span className="when">{text.when}</span>
            </button>
          );
        })}
      </div>
      {items.length > TODO_PREVIEW && (
        <button type="button" className="btn small todo-more" onClick={() => setShowAllTodos(!showAllTodos)}>
          {showAllTodos ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </section>
  );
}
