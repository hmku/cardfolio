"use client";

import { useState } from "react";
import type { Portfolio, Product } from "../lib/core/model";
import type { DueItem } from "../lib/core/stats";
import { dueText } from "../lib/presentation/due";

const TODO_PREVIEW = 5;

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
