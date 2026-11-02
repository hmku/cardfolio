"use client";

import { useState } from "react";
import type { CreditSuggestion } from "../lib/core/card-plaid";
import { holdingName, type Portfolio } from "../lib/core/model";
import { money, shortDate } from "../lib/presentation/format";

const PREVIEW = 4;

/**
 * Statement credits spotted in a linked card's transactions. Nothing is recorded until a
 * person taps Record; Dismiss hides the suggestion in this browser.
 */
export function CreditSuggestions({ portfolio, suggestions, onAccept, onDismiss, showCard = true }: {
  portfolio: Portfolio;
  suggestions: CreditSuggestion[];
  onAccept: (suggestion: CreditSuggestion) => void;
  onDismiss: (suggestion: CreditSuggestion) => void;
  /** Off inside a card's drawer, where the card is already the heading and "From your bank" the section. */
  showCard?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  if (!suggestions.length) return null;
  const shown = showAll ? suggestions : suggestions.slice(0, PREVIEW);
  const count = suggestions.length === 1 ? "1 credit to confirm" : `${suggestions.length} credits to confirm`;
  return (
    <section className="suggestions" aria-label="Suggested credit uses">
      {showCard
        ? <div className="todo-head"><h2>From your bank</h2><span className="meta">{count}</span></div>
        : <h4 className="suggestions-count">{count}</h4>}
      <ul className="suggestion-list">
        {shown.map((suggestion) => {
          const { credit, transaction, holding } = suggestion;
          const partial = suggestion.recordCents < credit.amountCents;
          return (
            <li key={suggestion.key} className="suggestion">
              <span className="grow">
                <strong>{credit.name}{showCard ? ` on ${holdingName(portfolio, holding)}` : ""}</strong>
                <small>
                  {money(transaction.amountCents)} &ldquo;{transaction.merchantName && !transaction.name.toLowerCase().includes(transaction.merchantName.toLowerCase()) ? `${transaction.merchantName} · ` : ""}{transaction.name}&rdquo; {shortDate(transaction.date)}
                  {" · "}{partial ? `records ${money(suggestion.recordCents)} of ${money(credit.amountCents)}` : `marks ${suggestion.period.label} used`}
                  {suggestion.maybeRefund && " · could be a refund"}
                </small>
              </span>
              <span className="inline-actions">
                <button type="button" className="btn small" onClick={() => onDismiss(suggestion)} aria-label={`Dismiss ${credit.name} suggestion`}>Dismiss</button>
                <button type="button" className="btn small primary" onClick={() => onAccept(suggestion)}>Record</button>
              </span>
            </li>
          );
        })}
      </ul>
      {suggestions.length > PREVIEW && (
        <button type="button" className="btn small todo-more" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${suggestions.length}`}</button>
      )}
    </section>
  );
}
