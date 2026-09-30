"use client";

type Props = { hasPeople: boolean; hasCredits: boolean; onAddPerson: () => void; onAddCard: () => void; onSettings: () => void };

/** Shown instead of the card list until the household has its first card. */
export function GettingStarted({ hasPeople, hasCredits, onAddPerson, onAddCard, onSettings }: Props) {
  const steps = [
    { done: hasPeople, text: "Add the people who hold cards. Their initials label each card, like csr AD1.", action: <button type="button" className="btn small primary" onClick={onAddPerson}>Add a cardholder</button> },
    { done: false, text: "Add your cards, open or closed. Pick a card type or create one as you go.", action: hasPeople && <button type="button" className="btn small primary" onClick={onAddCard}>+ Add card</button> },
    { done: hasCredits, text: "Optional: add each card type's statement credits in Settings to track them on the Credits tab.", action: hasPeople && <button type="button" className="btn small" onClick={onSettings}>Open Settings</button> },
  ];
  return (
    <section className="getting-started" aria-labelledby="getting-started-title">
      <h2 id="getting-started-title">Get started</h2>
      <ol>
        {steps.map((step, index) => (
          <li key={index} className={step.done ? "done" : ""}>
            <span className="step-text">{step.done ? "✓ " : ""}{step.text}</span>
            {!step.done && step.action}
          </li>
        ))}
      </ol>
    </section>
  );
}
